import { Commands, Container, Contracts, Utils } from "@solar-network/cli";
import { Networks } from "@solar-network/crypto";
import { Container as KernelContainer, Contracts as KernelContracts } from "@solar-network/kernel";
import Joi from "joi";

/**
 * @export
 * @class Command
 * @extends {Commands.Command}
 */
@Container.injectable()
export class Command extends Commands.Command {
    /**
     * The console command signature.
     *
     * @type {string}
     * @memberof Command
     */
    public signature: string = "snapshot:restore";

    /**
     * The console command description.
     *
     * @type {string}
     * @memberof Command
     */
    public description: string = "Import data from specified snapshot";

    /**
     * Configure the console command.
     *
     * @returns {void}
     * @memberof Command
     */
    public configure(): void {
        this.definition
            .setFlag("emoji", "Show emoji in the output", Joi.boolean())
            .setFlag("token", "The name of the token", Joi.string().default("solar"))
            .setFlag("network", "The name of the network", Joi.string().valid(...Object.keys(Networks)))
            .setFlag("blocks", "Blocks to import, correlates to folder name", Joi.string().required())
            .setFlag("truncate", "Empty all tables before running import", Joi.boolean())
            .setFlag("verify", "Verify signatures of specified snapshot", Joi.boolean());
    }

    /**
     * Execute the console command.
     *
     * @returns {Promise<void>}
     * @memberof Command
     */
    public async execute(): Promise<void> {
        this.actions.abortRunningProcess("core");
        this.actions.abortRunningProcess("relay");

        const emoji: boolean | undefined = this.getFlag("emoji");
        if (emoji !== undefined) {
            process.env.SOLAR_CORE_LOG_EMOJI_DISABLED = (!emoji).toString();
        }

        const flags: Contracts.AnyObject = { ...this.getFlags() };
        flags.processType = "snapshot";

        const app = await Utils.buildApplication({
            flags,
        });

        await app
            .get<KernelContracts.Snapshot.SnapshotService>(KernelContainer.Identifiers.SnapshotService)
            .restore(flags as any);

        await app.terminate();
    }
}
