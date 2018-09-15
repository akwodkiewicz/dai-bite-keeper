const Maker = require("@makerdao/dai");
const Cdp = require("@makerdao/dai/src/eth/Cdp");
const winston = require("winston");
const conversion = require("@makerdao/dai/src/utils/conversion");
const fs = require("fs");

const maker = Maker.create("kovan", {
    privateKey: fs.readFileSync("./.privatekey", "utf8")
});

const logger = winston.createLogger({
    level: "debug",
    format: winston.format.timestamp(),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.align(),
                winston.format.printf(
                    info => `${info.timestamp} [${info.level}]: ${info.message}`
                )
            )
        })
    ]
});

// async function benchmark() {
//     var numOfIterations = 1000;
//
//     let start = process.hrtime();
//     logger.log("Started on: " + start);
//     for (let index = 1; index <= numOfIterations; index++) {
//         try {
//             await maker.getCdp(index);
//         } catch {
//             //
//         }
//     }
//     let stop = process.hrtime();
//     logger.log("Stopped on: " + stop);
//     let elapsedTime =
//         (stop[0] - start[0]) * 1000 + (stop[1] - start[1]) / 1000000;
//     logger.log(`Elapsed time: ${elapsedTime} ms`);
//     logger.log(`Time per call: ${elapsedTime / numOfIterations} ms`);
// }

function parseArguments() {
    let a, b;

    if (process.argv.length <= 2) {
        a = 1;
        b = 100;
    } else if (process.argv.length == 3) {
        a = parseInt(process.argv[2]);
        b = a + 100;
    } else {
        a = parseInt(process.argv[2]);
        b = parseInt(process.argv[3]);
    }

    return [a, b];
}

async function getAvailableCdps(first = 1, last = 1000) {
    /**
     * TODO: Use graphQL when endpoint for Kovan is finally available
     */

    let cdpId = first;
    let result = [];
    let range = Array.from(new Array(last - first + 1), (x, i) => i + first);

    await Promise.all(
        range.map(async cdpId => {
            try {
                cdp = await maker.getCdp(cdpId);
                result.push([cdpId, cdp]);
            } catch {
                logger.debug(`CDP #${cdpId} does not exist!`);
            }
        })
    );

    return result;
}

async function groupToSafeAndUnsafe(cdpArray) {
    /**
     * TODO: Use graphQL when endpoint for Kovan is finally available
     */

    let safeCdps = [];
    let unsafeCdps = [];

    await Promise.all(
        cdpArray.map(async ([cdpId, cdp]) => {
            let isSafe;
            try {
                isSafe = await cdp.isSafe();
            } catch {
                logger.debug(`CDP #${cdpId} is not available`);
                return;
            }

            if (isSafe) {
                safeCdps.push([cdpId, cdp]);
            } else {
                unsafeCdps.push([cdpId, cdp]);
            }
        })
    );

    return [safeCdps, unsafeCdps];
}

async function biteBotMain() {
    var cdp, hexCdpId;

    while (true) {
        for (let cdpId = 750; cdpId < 760; cdpId++) {
            hexCdpId = conversion.numberToBytes32(cdpId);

            try {
                cdp = await maker.getCdp(cdpId);
            } catch {
                logger.log(`Cdp #${cdpId} does not exist!`);
                continue;
            }

            logger.log(`Checking if cdp #${cdpId} is safe...`);
            let isSafe;
            try {
                isSafe = await cdp.isSafe();
            } catch {
                logger.log(`Cdp #${cdpId} is not available`);
                continue;
            }
            if (isSafe) {
                logger.log(`Cdp #${cdpId} is safe :(`);
            } else {
                logger.log(`Cdp #${cdpId} is ready to be bitten!`);
                break;
            }
        }

        const bitePromise = cdp._cdpService
            ._tubContract()
            .bite(hexCdpId, { gasLimit: 4000000 });
        bitePromise.onPending(() => logger.log("pending!"));
        bitePromise.onMined(() => logger.log("mined!"));
        bitePromise.onFinalized(() => logger.log("finalized!"));

        const biteRes = await bitePromise;
        await bitePromise.confirm(5);
    }
}

async function bite(unsafeCdps) {
    if (unsafeCdps.length === 0) {
        logger.info("No CDPs to bite!");
        return;
    }

    const bitePromises = unsafeCdps.map(async ([cdpId, cdp]) => {
        let hexCdpId = conversion.numberToBytes32(cdpId);
        let bitePromise = cdp._cdpService
            ._tubContract()
            .bite(hexCdpId, { gasLimit: 4000000 });
        /* or without gasLimit parameter (but still undocumented!):
            let bitePromise = cdp.bite(cdpId);
            */
        bitePromise.onPending(() => logger.log("pending!"));
        bitePromise.onMined(() => logger.log("mined!"));
        bitePromise.onFinalized(() => logger.log("finalized!"));
    });

    const minedBitePromises = Promise.all(bitePromises).then(
        logger.info("All 'bite' transactions have been mined!")
    );
    Promise.all(
        minedBitePromises.map(bitePromise => bitePromise.confirm(3))
    ).then(logger.info("All 'bite' transactions have 3-block confirmations!"));
}

async function monitoring() {}

async function main() {
    const args = parseArguments();

    await maker.authenticate();
    logger.info("Authenticated");
    return;
    logger.info("Preparing list of available CDPs...");
    const cdps = await getAvailableCdps(args[0], args[1]);

    logger.info("Available CDPs:");
    logger.info(cdps.map(([cdpId, cdp]) => cdpId));

    logger.info("Grouping CDPs into safe and unsafe...");
    const [safeCdps, unsafeCdps] = await groupToSafeAndUnsafe(cdps);

    logger.info("Safe CDPs:");
    logger.info(safeCdps.map(([cdpId, cdp]) => cdpId));

    logger.info("Unsafe CDPs:");
    logger.info(unsafeCdps.map(([cdpId, cdp]) => cdpId));

    logger.info(`Starting 'bite' operation`);
    await bite(unsafeCdps);

    logger.info(`Starting safe CDPs monitoring. Press Ctrl+C to quit.`);
    await monitoring(safeCdps);
}

main()
    .catch(e => {
        logger.error(e.message);
        process.exit(1);
    })
    .then(() => process.exit(0));
