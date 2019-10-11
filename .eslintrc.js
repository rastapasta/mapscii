module.exports = {
    "env": {
        "es6": true,
        "node": true,
        "jest": true
    },
    "parserOptions": {
        "ecmaVersion": 2018
    },
    "extends": [
        "eslint:recommended",
        "plugin:jest/recommended"
    ],
    "rules": {
        "indent": [
            "error",
            2,
            {
              "SwitchCase": 1
            }
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "no-console": 0,
        "quotes": [
            "error",
            "single"
        ],
        "semi": [
            "error",
            "always"
        ]
    }
};
