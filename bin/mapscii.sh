#!/bin/sh
':' //; # Based on https://github.com/MrRio/vtop/blob/master/bin/vtop.js
':' //; export TERM=xterm-256color
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
'use strict'
require('../main.js');
