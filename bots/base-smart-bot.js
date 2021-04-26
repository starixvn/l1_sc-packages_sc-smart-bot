import Chance from "chance";
import EventEmitter from "eventemitter3";
import mongoose from "mongoose";

export default class BaseSmartBot {
    /**
     * @param {BetPatternConsumer} betPatternConsumer
     * @param {mongoose.Model} smartBotBetLogsRepository
     * @param {BaseEventPublisher} publisher
     */

    constructor(definition, gameData, publisher, betPatternConsumer, smartBotBetLogsRepository, userInfosRepository, tempBetsRepository) {
        this.betPatternConsumer = betPatternConsumer;
        this.smartBotBetLogsRepository = smartBotBetLogsRepository;
        this.userInfosRepository = userInfosRepository;

        this.smartBots = [];
        this.chance = new Chance();
        this.choiceMapper = definition.choices;

        this.maxBetOfChoices = null;
        this.afterPlacingBet = null;
        this.beforeRemovingAll = null;
        this.insertOrUpdateBetAsync = null;

        this.gameData = gameData;
        this.publisher = publisher;
        this.tempBetsRepository = tempBetsRepository;
        this.eventEmitter = new EventEmitter();
    }

    async reset(
        { smartBotEnabled, maxBetOfChoices, smartBotGroupRatio, wholeRound },
        { userResetFilters, userUpdateFilters, userUpdates, userProjections }
    ) {
        let isExpired = false;
        if (smartBotEnabled) {
            this.maxBetOfChoices = maxBetOfChoices;
            isExpired = await this.betPatternConsumer.resetAndUpdatePatterns({ smartBotEnabled, smartBotGroupRatio }, wholeRound);

            if (isExpired) {
                await this.removeAll();
            }

            if (this.smartBots.length === 0) {
                this.smartBots = await this.assignPatterns(
                    userResetFilters,
                    userUpdateFilters,
                    userUpdates,
                    userProjections,
                    this.betPatternConsumer.getPatterns()
                );
            }
        } else {
            await this.removeAll();
        }

        return { isExpired, smartBots: this.smartBots };
    }

    async assignPatterns(customResetFilters, customUpdateFilters, customUpdates, userProjections, patterns) {
        const maxInitializeAmount = 88000;
        const minInitializeAmount = 36000;

        const resetFilters = { ...customResetFilters, type: true, patternId: { $gt: 0 } };

        await this.userInfosRepository.updateMany(resetFilters, { patternId: 0 });

        const bots = await this.userInfosRepository.aggregate([
            {
                $match: {
                    ...customUpdateFilters,
                    type: true,
                },
            },
            { $sample: { size: patterns.length } },
            { $project: userProjections },
        ]);

        for (let index = 0; index < patterns.length; index++) {
            const pattern = patterns[index];
            const bot = bots[index];

            if (bot) {
                const amount = this.chance.integer({ min: minInitializeAmount, max: maxInitializeAmount });
                const updateFilters = { ...customUpdateFilters, id: bot.id, type: true };
                const updates = { ...customUpdates, patternId: pattern._id, red: amount };

                await this.userInfosRepository.updateOne(updateFilters, updates);

                bot.patternId = pattern._id;
                bot.red = amount;
            }
        }

        return bots;
    }

    async removeAll() {
        this.eventEmitter.emit("removeAll", this.smartBots);

        this.smartBots = [];
    }

    async run(roundId, remainingTime) {
        this.smartBots.forEach((smartBot) => {
            smartBot.betActions = this.betPatternConsumer.getBetActions(smartBot.patternId);
        });

        for (const smartBot of this.smartBots) {
            const actionsInSecond = smartBot.betActions.filter((betAction) => betAction.second === remainingTime) ?? [];
            for (const action of actionsInSecond) {
                const { bot, choice, amount, balance } = await this.placeBet(smartBot, action, roundId);

                this.eventEmitter.emit("placeBet", bot, choice, amount, balance);
                this.eventEmitter.emit("adjustBet", bot, choice, amount, balance);
            }
        }
    }

    async placeBet(bot, betAction, roundId) {}

    generateChoiceAndAmount(betAction) {
        const { choiceId, amount } = betAction ?? { choiceId: 0, amount: 0 };
        const choice = this.convertBetChoice(choiceId);

        return choice && amount > 0 ? { choice, amount: this.reduceAmountIfOverMaxBet(choice, amount) } : { choice, amount };
    }

    convertBetChoice(choiceId) {
        return choiceId > 0 ? this.choiceMapper[choiceId - 1] : null;
    }

    reduceAmountIfOverMaxBet(choice, amount) {
        const maxBetPerChoice = this.maxBetOfChoices[choice] || 0;

        return Math.min(amount, maxBetPerChoice);
    }

    async insertBetActionLogs(bot, { choiceId, amount, second, roundId }) {
        if (this.smartBotBetLogsRepository) {
            await this.smartBotBetLogsRepository.create({
                uid: bot.id,
                name: bot.name,
                patternId: bot.patternId,
                round: roundId,
                time: new Date(),
                choiceId,
                amount,
                second,
            });
        }
    }

    getSmartBots() {
        return this.smartBots;
    }

    registerPlaceBetEvent(func, context) {
        this.eventEmitter.on("placeBet", func, context);
    }

    registerRemoveAllBotEvent(func, context) {
        this.eventEmitter.on("removeAll", func, context);
    }

    registerAdjustBetEvent(asyncFunc, context) {
        this.eventEmitter.on("adjustBet", asyncFunc, context);
    }

    onError(func) {
        this.eventEmitter.on("error", func);
    }
}
