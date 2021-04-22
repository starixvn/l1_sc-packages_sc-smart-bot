import BaseSmartBot from "./base-smart-bot";

export default class TableGameSmartBot extends BaseSmartBot {
    async placeBet(bot, betAction, roundId) {
        if (!betAction) {
            return;
        }

        const { choice, amount } = this.generateChoiceAndAmount(betAction);

        const user = await this.userInfosRepository
            .findOneAndUpdate({ id: bot.id, red: { $gt: amount } }, { $inc: { red: -amount } }, { new: true })
            .lean();

        if (user) {
            await this.insertBetActionLogs(bot, { choiceId: betAction.choiceId, amount, second: betAction.second, roundId });

            if (this.afterPlacingBet) {
                this.afterPlacingBet(bot, user.red, choice, amount);
            }

            if (this.insertOrUpdateBetAsync) {
                await this.insertOrUpdateBetAsync(bot, choice, amount);
            }
        }

        return { bot, choice, amount };
    }

    generateChoiceAndAmount(betAction) {
        const { choiceId, amount } = betAction ?? { choiceId: 0, amount: 0 };
        const choice = this.convertBetChoice(choiceId);

        return choice && amount > 0 ? { choice, amount: this.reduceAmountIfOverMaxBet(choice, amount) } : { choice, amount };
    }

    reduceAmountIfOverMaxBet(choice, amount) {
        const maxBetPerChoice = this.maxBetOfChoices[choice] || 0;

        return Math.min(amount, maxBetPerChoice);
    }
}
