const Maker = require("@makerdao/dai");
const Cdp = require("@makerdao/dai/src/eth/Cdp");
const winston = require("winston");
const conversion = require("@makerdao/dai/src/utils/conversion");
const fs = require("fs");

const maker = Maker.create("kovan", {
    privateKey: fs.readFileSync("./.privatekey", "utf8")
});

var cdpService;

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

function parseArguments() {
    let a, b, c;

    if (process.argv.length <= 2) {
        a = 1;
        b = 100;
        c = false;
    } else if (process.argv.length == 3) {
        a = parseInt(process.argv[2]);
        b = a + 100;
        c = false;
    } else if (process.argv.length == 4) {
        a = parseInt(process.argv[2]);
        b = parseInt(process.argv[3]);
        c = false;
    } else {
        a = parseInt(process.argv[2]);
        b = parseInt(process.argv[3]);
        c = process.argv[4] === "1" ? true : false;
    }

    return [a, b, c];
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

async function biteMany(unsafeCdps) {
    if (unsafeCdps.length === 0) {
        logger.info("No CDPs to bite!");
        return;
    }

    let promises = [];
    for (let i = 0; i < unsafeCdps.length; i++) {
        let cdpId = unsafeCdps[i][0];
        let hexCdpId = conversion.numberToBytes32(cdpId);

        const bitePromise = cdpService
            ._tubContract()
            .bite(hexCdpId, { gasLimit: 4000000 });
        bitePromise.onPending(() => logger.debug(`#${cdpId} pending!`));
        bitePromise.onMined(() => {
            logger.debug(`#${cdpId} mined!`);
            logger.info("💣💥 Here comes the BOOM operation 💣💥");
        });
        bitePromise.onFinalized(() => logger.debug(`#${cdpId} finalized!`));
        promises.push(bitePromise);
    }
    try {
        await Promise.all(promises);
    } catch (error) {
        logger.error(error.message);
        logger.error("Not all transactions were finalized!");
        return;
    }
    logger.info("All 'bite' transactions have been finalized!");
    try {
        await Promise.all(promises.map(bitePromise => bitePromise.confirm(3)));
    } catch (error) {
        logger.error(error.message);
        logger.error("Not all transactions could be confirmed!");
        return;
    }
    logger.info("All 'bite' transactions have 3-block confirmations!");
}
async function monitoring(safeCdps) {
    let removed = [];
    let processing = [];
    while (true) {
        if (safeCdps.length === removed.length) {
            logger.info("No more safe CDPs");
            return;
        }
        await Promise.all(
            safeCdps
                .filter(([cdpId, cdp]) => !removed.includes(cdpId))
                .filter(([cdpId, cdp]) => !processing.includes(cdpId))
                .map(async ([cdpId, cdp]) => {
                    try {
                        let isSafe = await cdp.isSafe();
                        if (isSafe) {
                            logger.debug(`CDP ${cdpId} is still safe`);
                            return;
                        }
                        logger.info(
                            `CDP #${cdpId} is not safe anymore! Sending bite transaction...`
                        );
                        processing.push(cdpId);
                        let hexCdpId = conversion.numberToBytes32(cdpId);
                        const bitePromise = cdpService
                            ._tubContract()
                            .bite(hexCdpId, { gasLimit: 4000000 });
                        bitePromise.onPending(() => logger.debug(`#${cdpId} pending!`));
                        bitePromise.onMined(() => {
                            logger.debug(`#${cdpId} mined!`);
                            logger.info("💣💥 Here comes the BUST operation 💣💥");
                        });
                        bitePromise.onFinalized(() =>
                            logger.debug(`#${cdpId} finalized!`)
                        );
                        bitePromise
                            .then(function() {
                                logger.info(
                                    `Bite transaction for #${cdpId} has been finalized!`
                                );
                                logger.info(
                                    `Removing successfully bitten CDP #${cdpId} from monitored set`
                                );
                                processing = processing.filter(item => item !== cdpId);
                                removed.push(cdpId);
                            })
                            .then(function() {
                                bitePromise.confirm(3).then(function() {
                                    logger.info(
                                        `Bite transaction for #${cdpId} has 3-block confirmation!`
                                    );
                                });
                            });
                    } catch (error) {
                        logger.error(error);
                        logger.warn(
                            `Removing unavailable CDP #${cdpId} from monitored set`
                        );
                        removed.push(cdpId);
                    }
                })
        );
    }
}
async function main() {
    const args = parseArguments();
    await maker.authenticate();
    logger.info("Authenticated");
    cdpService = maker.service("cdp");
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
    if (!args[2]) {
        logger.info(`Starting 'bite' operation`);
        await biteMany(unsafeCdps);
        logger.info(`Starting safe CDPs monitoring. Press Ctrl+C to quit.`);
        await monitoring(safeCdps);
    } else {
        logger.info(`Starting safe CDPs monitoring. Press Ctrl+C to quit.`);
        await monitoring(safeCdps.concat(unsafeCdps));
    }
    logger.info("Exiting");
}
main()
    .catch(e => {
        logger.error(e.message);
        process.exit(1);
    })
    .then(() => process.exit(0));
