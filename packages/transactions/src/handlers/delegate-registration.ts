import { Enums, Interfaces, Transactions, Utils } from "@solar-network/crypto";
import { Container, Contracts, Enums as AppEnums, Utils as AppUtils } from "@solar-network/kernel";

import { WalletIsAlreadyDelegateError, WalletUsernameAlreadyRegisteredError } from "../errors";
import { TransactionHandler, TransactionHandlerConstructor } from "./transaction";

@Container.injectable()
export class DelegateRegistrationTransactionHandler extends TransactionHandler {
    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.TransactionHistoryService)
    private readonly transactionHistoryService!: Contracts.Shared.TransactionHistoryService;

    @Container.inject(Container.Identifiers.PoolQuery)
    private readonly poolQuery!: Contracts.Pool.Query;

    public dependencies(): ReadonlyArray<TransactionHandlerConstructor> {
        return [];
    }

    public walletAttributes(): ReadonlyArray<string> {
        return [
            "delegate.forgedFees", // Used by the API
            "delegate.burnedFees", // Used by the API
            "delegate.forgedRewards", // Used by the API
            "delegate.donations", // Used by the API
            "delegate.forgedTotal", // Used by the API
            "delegate.lastBlock",
            "delegate.missedBlocks", // Used by the API
            "delegate.producedBlocks", // Used by the API
            "delegate.productivity", // Used by the API
            "delegate.rank",
            "delegate.round",
            "delegate.username",
            "delegate.version", // Used by the API
            "delegate.voteBalance",
            "delegate.voters", // Used by the API
            "delegate",
        ];
    }

    public getConstructor(): Transactions.TransactionConstructor {
        return Transactions.DelegateRegistrationTransaction;
    }

    public async bootstrap(): Promise<void> {
        const criteria = {
            type: this.getConstructor().key,
        };

        for await (const transaction of this.transactionHistoryService.fetchByCriteria(criteria)) {
            AppUtils.assert.defined<string>(transaction.senderId);
            AppUtils.assert.defined<string>(transaction.asset?.registration?.username);

            const wallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.senderId);
            if (
                transaction.headerType === Enums.TransactionHeaderType.Standard &&
                wallet.getPublicKey("primary") === undefined
            ) {
                wallet.setPublicKey(transaction.senderPublicKey, "primary");
            }

            wallet.setAttribute<Contracts.State.WalletDelegateAttributes>("delegate", {
                username: transaction.asset.registration.username,
                voteBalance: Utils.BigNumber.ZERO,
                forgedFees: Utils.BigNumber.ZERO,
                burnedFees: Utils.BigNumber.ZERO,
                forgedRewards: Utils.BigNumber.ZERO,
                donations: Utils.BigNumber.ZERO,
                producedBlocks: 0,
                rank: undefined,
                voters: 0,
            });

            this.walletRepository.index(wallet);
        }

        const forgedBlocks = await this.blockRepository.getDelegatesForgedBlocks();
        const lastForgedBlocks = await this.blockRepository.getLastForgedBlocks();

        for (const block of forgedBlocks) {
            if (!block.username) {
                continue;
            }

            const wallet: Contracts.State.Wallet = this.walletRepository.findByUsername(block.username);
            const delegate: Contracts.State.WalletDelegateAttributes = wallet.getAttribute("delegate");
            delegate.burnedFees = delegate.forgedFees.plus(block.totalFeesBurned);
            delegate.forgedFees = delegate.forgedFees.plus(block.totalFees);
            delegate.forgedRewards = delegate.forgedRewards.plus(block.totalRewards);
            delegate.donations = delegate.donations.plus(block.donations || Utils.BigNumber.ZERO);
            delegate.producedBlocks += +block.totalProduced;
        }

        for (const block of lastForgedBlocks) {
            if (!block.username) {
                continue;
            }

            const wallet: Contracts.State.Wallet = this.walletRepository.findByUsername(block.username);

            block.donations = Utils.calculateDonations(block.height, block.reward);
            wallet.setAttribute("delegate.lastBlock", block);
        }
    }

    public async isActivated(transaction?: Interfaces.ITransaction): Promise<boolean> {
        return true;
    }

    public async throwIfCannotBeApplied(
        transaction: Interfaces.ITransaction,
        wallet: Contracts.State.Wallet,
    ): Promise<void> {
        const { data }: Interfaces.ITransaction = transaction;

        AppUtils.assert.defined<string>(data.asset?.registration?.username);

        const username: string = data.asset.registration.username;

        if (wallet.isDelegate()) {
            throw new WalletIsAlreadyDelegateError();
        }

        if (this.walletRepository.hasByUsername(username)) {
            throw new WalletUsernameAlreadyRegisteredError(username);
        }

        return super.throwIfCannotBeApplied(transaction, wallet);
    }

    public emitEvents(transaction: Interfaces.ITransaction): void {
        this.events.dispatch(AppEnums.DelegateEvent.Registered, {
            ...transaction.data,
            username: transaction.data.asset?.registration?.username,
        });
    }

    public async throwIfCannotEnterPool(transaction: Interfaces.ITransaction): Promise<void> {
        AppUtils.assert.defined<string>(transaction.data.senderId);

        const hasSender: boolean = this.poolQuery
            .getAllBySender(transaction.data.senderId)
            .whereKind(transaction)
            .has();

        if (hasSender) {
            throw new Contracts.Pool.PoolError(
                `${transaction.data.senderId} already has a delegate registration transaction in the pool`,
                "ERR_PENDING",
            );
        }

        AppUtils.assert.defined<string>(transaction.data.asset?.registration?.username);
        const username: string = transaction.data.asset.registration.username;
        const hasUsername: boolean = this.poolQuery
            .getAll()
            .whereKind(transaction)
            .wherePredicate((t) => t.data.asset?.registration?.username === username)
            .has();

        if (hasUsername) {
            throw new Contracts.Pool.PoolError(
                `Delegate registration for '${username}' already in the pool`,
                "ERR_PENDING",
            );
        }
    }

    public async applyToSender(transaction: Interfaces.ITransaction): Promise<void> {
        await super.applyToSender(transaction);

        AppUtils.assert.defined<string>(transaction.data.senderId);

        const senderWallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.data.senderId);

        AppUtils.assert.defined<string>(transaction.data.asset?.registration?.username);

        senderWallet.setAttribute<Contracts.State.WalletDelegateAttributes>("delegate", {
            username: transaction.data.asset.registration.username,
            voteBalance: Utils.BigNumber.ZERO,
            forgedFees: Utils.BigNumber.ZERO,
            burnedFees: Utils.BigNumber.ZERO,
            forgedRewards: Utils.BigNumber.ZERO,
            donations: Utils.BigNumber.ZERO,
            producedBlocks: 0,
            round: 0,
            voters: 0,
        });

        this.walletRepository.index(senderWallet);
    }

    public async revertForSender(transaction: Interfaces.ITransaction): Promise<void> {
        await super.revertForSender(transaction);

        AppUtils.assert.defined<string>(transaction.data.senderId);

        const senderWallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.data.senderId);

        senderWallet.forgetAttribute("delegate");

        this.walletRepository.index(senderWallet);
    }

    public async applyToRecipient(transaction: Interfaces.ITransaction): Promise<void> {}

    public async revertForRecipient(transaction: Interfaces.ITransaction): Promise<void> {}
}
