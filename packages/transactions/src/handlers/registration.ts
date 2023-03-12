import { Interfaces, Managers, Transactions } from "@solar-network/crypto";
import { Container, Contracts, Enums as AppEnums, Utils as AppUtils } from "@solar-network/kernel";

import { WalletAlreadyHasUsernameError, WalletUsernameAlreadyRegisteredError } from "../errors";
import { TransactionHandler, TransactionHandlerConstructor } from "./transaction";
import { UpgradeTransactionHandler } from "./upgrade";

@Container.injectable()
export class RegistrationTransactionHandler extends TransactionHandler {
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
        return [...UpgradeTransactionHandler.walletAttributes(), "username"];
    }

    public getConstructor(): Transactions.TransactionConstructor {
        return Transactions.RegistrationTransaction;
    }

    public async bootstrap(): Promise<void> {
        const criteria = {
            type: this.getConstructor().key,
        };

        for await (const transaction of this.transactionHistoryService.fetchByCriteria(criteria)) {
            AppUtils.assert.defined<string>(transaction.senderId);
            AppUtils.assert.defined<string>(transaction.asset?.registration?.username);

            const wallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.senderId);
            this.performWalletInitialisation(transaction, wallet);

            if (Managers.configManager.getMilestone(transaction.blockHeight).autoUpgradeUsernamesToBlockProducers) {
                UpgradeTransactionHandler.setBlockProducerAttributes(wallet, transaction);
            }
            wallet.setAttribute("username", transaction.asset.registration.username);

            this.walletRepository.index(wallet);
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

        if (wallet.hasAttribute("username")) {
            throw new WalletAlreadyHasUsernameError();
        }

        if (this.walletRepository.hasByUsername(username)) {
            throw new WalletUsernameAlreadyRegisteredError(username);
        }

        return super.throwIfCannotBeApplied(transaction, wallet);
    }

    public emitEvents(transaction: Interfaces.ITransaction): void {
        const username: string | undefined = transaction.data.asset?.registration?.username;
        this.events.dispatch(AppEnums.UsernameEvent.Registered, {
            ...transaction.data,
            username,
        });

        if (Managers.configManager.getMilestone(transaction.data.blockHeight).autoUpgradeUsernamesToBlockProducers) {
            UpgradeTransactionHandler.emitBlockProducerRegistrationEvent(this.events, transaction.data, username);
        }
    }

    public async throwIfCannotEnterPool(transaction: Interfaces.ITransaction): Promise<void> {
        AppUtils.assert.defined<string>(transaction.data.senderId);

        const hasSender: boolean = this.poolQuery
            .getAllBySender(transaction.data.senderId)
            .whereKind(transaction)
            .has();

        if (hasSender) {
            throw new Contracts.Pool.PoolError(
                `${transaction.data.senderId} already has a registration transaction in the pool`,
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
            throw new Contracts.Pool.PoolError(`Registration for '${username}' already in the pool`, "ERR_PENDING");
        }
    }

    public async applyToSender(transaction: Interfaces.ITransaction): Promise<void> {
        await super.applyToSender(transaction);

        AppUtils.assert.defined<string>(transaction.data.senderId);

        const senderWallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.data.senderId);

        AppUtils.assert.defined<string>(transaction.data.asset?.registration?.username);

        if (Managers.configManager.getMilestone(transaction.data.blockHeight).autoUpgradeUsernamesToBlockProducers) {
            UpgradeTransactionHandler.setBlockProducerAttributes(senderWallet, transaction.data);
        }

        senderWallet.setAttribute("username", transaction.data.asset.registration.username);

        this.walletRepository.index(senderWallet);
    }

    public async revertForSender(transaction: Interfaces.ITransaction): Promise<void> {
        await super.revertForSender(transaction);

        AppUtils.assert.defined<string>(transaction.data.senderId);

        const senderWallet: Contracts.State.Wallet = this.walletRepository.findByAddress(transaction.data.senderId);

        if (Managers.configManager.getMilestone(transaction.data.blockHeight).autoUpgradeUsernamesToBlockProducers) {
            UpgradeTransactionHandler.forgetBlockProducerAttributes(senderWallet, transaction.data);
        }

        senderWallet.forgetAttribute("username");

        this.walletRepository.index(senderWallet);
    }

    public async applyToRecipient(transaction: Interfaces.ITransaction): Promise<void> {}

    public async revertForRecipient(transaction: Interfaces.ITransaction): Promise<void> {}
}
