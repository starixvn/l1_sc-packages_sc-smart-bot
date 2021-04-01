import Chance from "chance";
import moment from "moment";
import mongoose from "mongoose";

export default class BetPatternConsumer {
	/**
	 * @param {mongoose.Model} userInfosRepository
	 * @param {mongoose.Model} betPatternRepository
	 * @param {mongoose.Model} betActionRepository
	 */
	constructor({ userInfosRepository, betPatternRepository, betActionRepository }) {
		this.userInfosRepository = userInfosRepository;
		this.betPatternRepository = betPatternRepository;
		this.betActionRepository = betActionRepository;

		this.followingDatePattern = null;
		this.currentRatioOfGroups = 0;
		this.patterns = [];
		this.betActions = [];
		this.expiredTime = moment.utc();
		this.chance = new Chance();
		this.patternExpiryTime = 24;
	}

	async resetAndUpdatePatterns({ smartBotEnabled, smartBotGroupRatio }, wholeRound) {
		if (smartBotEnabled) {
			const currentTime = moment.utc();
			const isExpired = this.isExpired(currentTime, this.patternExpiryTime) || this.currentRatioOfGroups !== smartBotGroupRatio;

			if (isExpired) {
				await this.generateGroupedPatterns();
				this.patterns = await this.randomPickedByGroup(this.followingDatePattern, smartBotGroupRatio);
				this.currentRatioOfGroups = smartBotGroupRatio;
			}

			await this.getBetActionsInTimeFrame(currentTime, wholeRound);

			return isExpired;
		} else {
			this.patterns = [];
			this.betActions = [];
		}

		return false;
	}

	isExpired(currentTime, botPatternExpiredInHours) {
		if (this.expiredTime < currentTime) {
			this.expiredTime = moment().startOf("day").add(botPatternExpiredInHours, "hours");

			return true;
		}

		return false;
	}

	async generateGroupedPatterns() {
		const highStakePatternsByDate = await this.betPatternRepository.aggregate([{ $sample: { size: 1 } }]).exec();
		this.followingDatePattern = highStakePatternsByDate[0].time;
		this.betActions = [];
	}

	async randomPickedByGroup(time, smartBotGroupRatio) {
		const allGroups = await this.betPatternRepository.find({ time: time }, "_id group").lean().exec();
		const distinctGroups = [...new Set(allGroups.map((pattern) => pattern.group))];
		const pickedGroups = this.chance.pickset(distinctGroups, Math.round(distinctGroups.length * smartBotGroupRatio));

		return allGroups.filter((pattern) => pickedGroups.includes(pattern.group));
	}

	async getBetActionsInTimeFrame(currentTime, durationOfWholeRound) {
		if (this.patterns.length > 0) {
			const startTime = currentTime.valueOf() % (24 * 3600 * 1000);
			const endTime = startTime + durationOfWholeRound * 1000;

			const times = await this.betActionRepository
				.find({ patId: { $in: this.patterns }, time: { $gt: startTime, $lt: endTime } })
				.distinct("time")
				.lean()
				.exec();

			if (times.length > 0) {
				this.betActions = await this.betActionRepository
					.find({ time: { $in: times } })
					.lean()
					.exec();
			}
		}
	}

	getBetActions(patternId) {
		return this.betActions.filter((action) => action.patId === patternId);
	}

	getPatterns() {
		return this.patterns;
	}
}
