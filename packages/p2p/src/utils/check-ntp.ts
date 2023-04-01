import Sntp, { TimeOptions } from "@hapi/sntp";
import { Container, Contracts, Utils } from "@solar-network/kernel";

export const checkNTP = (
    app: Contracts.Kernel.Application,
    hosts: string[],
    timeout: number = 1000,
): Promise<{ time: TimeOptions; host: string }> => {
    return new Promise(async (resolve, reject) => {
        for (const host of Utils.shuffle(hosts)) {
            try {
                const time: Sntp.TimeOptions = await Sntp.time({
                    host,
                    timeout,
                });

                return resolve({ time, host });
            } catch (err) {
                app.getTagged<Contracts.Kernel.Logger>(Container.Identifiers.LogService, "package", "p2p").error(
                    `Host ${host} responded with: ${err.message}`,
                );
            }
        }

        reject(new Error("Please check your NTP connectivity, couldn't connect to any host"));
    });
};
