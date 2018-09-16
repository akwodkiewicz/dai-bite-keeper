# Dai-bite-keeper

Bot for automatic CDP-biting

## About

This NodeJS app is a bot for monitoring Collateralized Debt Positions and _biting_ them as soon as they become _unsafe_.
It depends on [Dai.js](https://github.com/makerdao/dai.js) library.

## Usage

You have to provide a text `.privatekey` file containing your private key inside root application folder in order for authentication to complete.

Then run following commands:

```bash
npm install
node app.js [<minCdpId> [<maxCdpId>]]
```

By default `<minCdpId>` is set to 1 and `<maxCdpId>` is set to 100.
If you only provide the first argument, bot will monitor 100 CDPs, starting from `<minCdpId>`.

## Authors

Andrzej Wódkiewicz & Kamil Karpiesiuk