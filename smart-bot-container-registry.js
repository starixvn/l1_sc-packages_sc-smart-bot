import awilix from "awilix";

import { TableGameSmartBot } from "./bots";
import { BetPatternConsumer } from "./consumers";

const { asClass } = awilix;

export default class SmartBotContainerRegistry {
    register() {
        this.container.register({
            betPatternConsumer: asClass(BetPatternConsumer).singleton().proxy(),
            tableGameSmartBot: asClass(TableGameSmartBot).singleton(),
        });

        return this.container;
    }
}
