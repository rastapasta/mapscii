# SMS gateway

Answers text messages about places - for people without a smartphone or mobile data. It works offline, from what MapSCII knows: the places of the maps it has shown, saved places, field notes.

| Message | Reply |
|---|---|
| `Lodz` (or `Where is Łódź?`) | `Lodz (city): 51.76954, 19.45679, plus code QF94+RP Lodz` |
| `GCC7+8V Berlin` (or coordinates) | `52.52081, 13.41469, plus code GCC7+8V Berlin, 1.4 km E of Berlin` |
| `Accra to Kumasi` | `Kumasi is 202 km NW of Accra (in a straight line; roads are longer).` |
| `NEAR JR37+F6 Accra` | the nearest field notes |
| `NOTE broken pump AT JR37+F6 Accra` | adds a field note (only from the numbers of `--notes-from`) |
| `HELP` | how to ask |

Try it without a phone: `node tools/sms-gateway/gateway.js --ask "Kumasi"` (or `mapscii-sms --ask ...` once MapSCII is installed).

## Connecting a phone line

**A GSM modem** (a USB dongle with a SIM card, or a phone in modem mode):

```
node tools/sms-gateway/gateway.js --modem /dev/ttyUSB0
```

It reads the messages from the SIM, deletes each one it handles, and answers it. Replies in Latin letters go as normal messages (accents dropped: Łódź becomes Lodz, 160 characters); replies in other scripts as Unicode (70 characters). If it says "no permission": `sudo usermod -aG dialout $USER`, then log in again. `DEBUG=1` shows the conversation with the modem.

**An Android phone with an SMS gateway app** (which passes received messages on over HTTP and sends the response back):

```
node tools/sms-gateway/gateway.js --http 8090 --token SECRET
```

The app posts to `http://this-computer:8090/sms?token=SECRET` with the sender (`from`, `phone`, `phoneNumber`, `sender` or `number`) and the text (`text`, `message` or `body`), as form fields or JSON (also nested, e.g. `{"payload": {"phoneNumber": ..., "message": ...}}`). The response is the reply as plain text (or `{"reply": ...}` with `format=json`); an empty response means: no reply.

## Credit

Every reply costs credit, so the gateway answers each number at most 10 times an hour (`--max-per-hour`) and sends at most 100 replies a day (`--max-per-day`). `--allow "+233241234567,+233201234567"` answers only these numbers. Messages it doesn't answer get no reply at all - a refusal would cost credit too. Every message and reply is logged in `~/.local/share/mapscii-nodejs/sms-log.jsonl`.

## Not tested yet

This was tested with a simulated modem and simulated app requests, not with a real GSM modem or gateway app - those need the hardware and SMS credit. Modems differ in details; if one doesn't work, `DEBUG=1` shows where it stops.
