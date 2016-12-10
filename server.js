var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');
var fs = require('fs');

app.get('/', function(req, res) {
    var absolutePath = path.resolve('index.html');
    res.sendFile(absolutePath);
});

app.get('/jquery-2.2.4.js', function(req, res) {
    var absolutePath = path.resolve('jquery-2.2.4.js');
    res.sendFile(absolutePath);
});

var tmp_count;

var clients = {};
var data = {};
data = JSON.parse(fs.readFileSync('cah_full.json', 'utf8'));

var games = {};

var names = [
    'Bird Person','Donkey Kong','King Kong','Godzilla','T-rex',
    'SpongeBob','Patrick','Gary','Squidward','Mr. Crabs','Ham Burger','Left Shark',
    'Flappy','Fin','Jake','Lumpy Space Princess','Princess Bubblegum','Rick','Morty',
    'Peppermint Butler','Mr. Poopybutthole','Megamind','Metroman','Mario','Luigi','Buzzard','Hitler','Unity','Abradolf Lincler',
    'Mr. Meeseeks','Bob','Spock','Lizzard','Snakey','Droid','Darth Vader','Luke Skywalker',
    'Cyborg','Elvis','Jellybean','Ice-T'
]

var card_count;

io.on('connection', function(socket) {
    console.log('a user connected with ID ' + socket.id);
    clients[socket.id] = {};
    clients[socket.id].id = socket.id;

    socket.on('disconnect', function() {
        remove_player(socket.id);
        clients[socket.id] = undefined;
        console.log('user disconnected');
    });

    socket.on('get_games_from_server', function() {
        io.to(socket.id).emit('games_from_server', JSON.stringify(data.order));
    });

    socket.on('join_server', function(game) {
        clients[socket.id].game = game;
        clients[socket.id].name = get_unique_username(game);
        clients[socket.id].score = 0;

        io.to(socket.id).emit('game_title', data[game].name);
        socket.join('game_' + game);
        user_joined_game(socket.id);
    });

    socket.on('submitting_selected_cards', function(data) {
        var selected_cards = JSON.parse(data);
        selected_cards.user = socket.id;
        selected_cards.name = clients[socket.id].name;
        // send selection to host
        var game_id = clients[socket.id].game;
        io.to(socket.id).emit('white_cards_from_server', get_next_game_white_cards(game_id, selected_cards.cards.length));
        io.to(games[game_id].questioneer).emit('user_submitted_cards', JSON.stringify(selected_cards));
    });

    socket.on('selected_user_response', function(s) {
        var selection = JSON.parse(s);
        var game_id = clients[socket.id].game;
        // send end round
        io.to('game_' + game_id).emit('end_round', s);
        games[game_id].questioneer = selection.user;
        setTimeout(function() { next_round(game_id) }, 11000);
    });

    function next_round(game_id) {
        start_game(game_id);
        send_cards_to_players(game_id, false);
    }

    function user_joined_game(user_id) {
        var game_id = clients[user_id].game;
        if (games[game_id] == undefined) {
            games[game_id] = generate_new_game();
            games[game_id].players.push(socket.id);
            games[game_id].questioneer = socket.id;
            games[game_id].black = get_black_cards(game_id);
            games[game_id].white = get_white_cards(game_id);
            io.to(socket.id).emit('joined_server_as_host', clients[socket.id].name);
            console.log('user joined game');
        } else {
            // game already exists
            if (games[game_id].started == false) {
                games[game_id].players.push(socket.id);
                io.to(socket.id).emit('joined_server', clients[socket.id].name);
                update_usercount(games[game_id]);
            } else {
                io.to(socket.id).emit('system_error', 'A game is already in progress');
            }
        }
    }


    socket.on('start_game', function() {
        var game_id = clients[socket.id].game;
        if (games[game_id] == undefined) return;
        start_game(game_id);
        send_cards_to_players(game_id, true);
    });

    function update_usercount(g) {
        io.to(g.questioneer).emit('update_usercount', ArrayCount(g.players));
    }

    function start_game(game_id) {
        io.to('game_' + game_id).emit('game_started');
        games[game_id].started = true;
        for (var player of games[game_id].players) {
            if (player != undefined && player != null) {
                var msg;
                if (player == games[game_id].questioneer) {
                    msg = 'init_questioneer';
                    clients[player].score += +1;
                } else msg = 'init_player';
                io.to(player).emit(msg, ArrayCount(games[game_id].players));
            }
        }
    }

    function send_cards_to_players(game_id, new_game) {
        if (games[game_id] != undefined && ArrayCount(games[game_id].black) > 0) {
            var black_card = get_next_black_card_from_server(game_id);
            if (new_game == true) card_count = 7;
            for (var player of games[game_id].players) {
                if (player != undefined && player != null) {
                    io.to(player).emit('black_card_from_server', black_card);
                    if (new_game) {
                        io.to(player).emit('white_cards_from_server', get_next_game_white_cards(game_id, card_count));
                    } else {
                        io.to(player).emit('white_cards_from_server');
                    }
                }
            }
            card_count = tmp_count;
        } else {
            // black cards depleated || game destroyed
            for (var p of games[game_id].players) {
                if (p != undefined && p != null) {
                    io.to(p).emit('game_ended');
                    break;
                }
            }
            delete games[clients[socket.id].game];
        }
    }

    function get_next_game_white_cards(game_id, count) {
        var white_cards = [];
        for (var w_id in games[game_id].white) {
            var w = games[game_id].white[w_id];
            if (w != undefined && w != null) {
                if (count-- > 0) {
                    white_cards.push(data.whiteCards[w]);
                    // remove white cards from deck
                    games[game_id].white[w_id] = undefined;
                } else {
                    break;
                }
            }
        }
        return JSON.stringify(white_cards);
    }

    function get_next_black_card_from_server(game_id) {
        var black_card;
        // remove black card from deck
        for (var b_id in games[game_id].black) {
            var b = games[game_id].black[b_id];
            if (b != undefined && b != null) {
                black_card = data.blackCards[b];
                delete games[game_id].black[b_id];
                break;
            }
        }
        tmp_count = black_card.pick;
        return black_card;
    }

    function ArrayCount(arr) {
        var count = 0;
        if (arr != undefined) {
            for (var v of arr) {
                if (v != undefined && v != null) count++;
            }
        }
        return count;
    }

    function get_black_cards(game_id) {
        var tmp = [];
        for (var b of data[game_id].black) {
            tmp.push(b);
        }
        return shuffle(shuffle(tmp));
    }

    function get_white_cards(game_id) {
        var tmp = [];
        for (var w of data[game_id].white) {
            tmp.push(w);
        }
        return shuffle(shuffle(tmp));
    }

    function shuffle(arr) {
        var currentIndex = arr.length, tmpValue, rndIndex;
        while (0 !== currentIndex) {
            rndIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            tmpValue = arr[currentIndex];
            arr[currentIndex] = arr[rndIndex];
            arr[rndIndex] = tmpValue;
        }
        return arr;
    }

    function remove_player(pid) {
        var game_id = clients[pid].game;
        var g = games[game_id];
        if (g == undefined) return;
        for (p in g.players) {
            if (g.players[p] == pid) {
                delete g.players[p];
            }
        }
        if (ArrayCount(g.players) > 1) {
            // players left in the game
            if (pid != g.questioneer) {
                update_usercount(g);
            } else {
                // host left the game
                // choose new host
                for (var p of g.players) {
                    if (p != undefined && p != null) {
                        g.questioneer = p;
                        // notify new host
                        io.to(p).emit('joined_server_as_host');
                        update_usercount(p);
                        break;
                    }
                }
            }
        } else if (ArrayCount(g.players) == 1) {
            // only one player
            console.log('only one player');
            for (var p of g.players) {
                if (p != undefined && p != null) {
                    io.to(p).emit('game_ended');
                    break;
                }
            }
            g = undefined;
        } else {
            // game is empty
            g = undefined;
        }
        games[game_id] = g;
    }
});

function get_unique_username(game_id) {
    var username = 0;
    while (username == 0) {
        username = names[Math.floor(Math.random() * (names.length - 1))];
        if (clients != undefined) {
            for (var c_id in clients) {
                var c = clients[c_id];
                if (c != undefined && c != null) {
                    if (c.game == game_id) {
                        if (c.name == username) {
                            username = 0;
                        }
                    }
                }
            }
        }
    }
    return username;
}

function cleanObject(arr) {
    var tmp = [];
    var counter = -1;
    for (var v of arr) {
        if (v === null) continue;
        if (v === undefined) continue;
        tmp[++counter] = v;
    }
    return tmp;
}


function generate_new_game() {
    return {
        "players": [],
        "questioneer": -1,
        "started": false,
        "black": [],
        "white": []
    }
}

var ipaddress = process.env.NODE_IP || "127.0.0.1";
var port = process.env.NODE_PORT || 3000;
http.listen(port, ipaddress, function() {
    console.log('listening on ' + ipaddress + ":" + port);
});
