import type { MessageCreateOptions, Snowflake } from "discord.js";

import { time, TimestampStyles, userMention } from "discord.js";
import { client } from "strife.js";

import config from "../../common/config.ts";
import constants from "../../common/constants.ts";
import { ACTIVE_THRESHOLD_ONE, ACTIVE_THRESHOLD_TWO } from "./misc.ts";
import { getFullWeeklyData, recentXpDatabase } from "./util.ts";

export async function getChatters(): Promise<MessageCreateOptions | undefined> {
	const weeklyWinners = getFullWeeklyData();
	const winnerId = weeklyWinners[0]?.user;
	const winner =
		winnerId &&
		(await config.guild.members
			.fetch(winnerId)
			.catch(() => client.users.fetch(winnerId).catch(() => void 0)));
	weeklyWinners.splice(
		0,
		weeklyWinners.findIndex(
			(gain, index) => index > 3 && gain.xp !== weeklyWinners[index + 1]?.xp,
		) + 1 || weeklyWinners.length,
	);
	if (!weeklyWinners.length) return;

	const formatted = weeklyWinners.map(
		(user) =>
			`${weeklyWinners.findIndex((found) => found.xp === user.xp) + 6}) ${userMention(
				user.user,
			)} - ${Math.floor(user.xp).toLocaleString()} XP`,
	);

	while (formatted.join("\n").length > 4096) formatted.pop();
	const ending = ` ${(weeklyWinners[formatted.length]?.xp ?? 0).toLocaleString()} XP`;
	const filtered = ending ? formatted.filter((line) => !line.endsWith(ending)) : formatted;

	return {
		embeds: [
			{
				description: filtered.join("\n"),
				footer:
					ending ?
						{
							icon_url: config.guild.iconURL() ?? undefined,
							text: `${
								weeklyWinners.length - filtered.length
							} more users with <=${ending}`,
						}
					:	undefined,
				color: constants.themeColor,
				thumbnail: winner ? { url: winner.displayAvatarURL() } : undefined,
			},
		],
	};
}

export default async function getWeekly(date: Date): Promise<string> {
	const title = `## 🏆 Weekly Winners week of ${date.toLocaleString([], {
		month: "long",
		day: "numeric",
	})}`;
	const weeklyWinners = getFullWeeklyData();

	// Remove Active role from inactive members
	const latestActiveMembers = weeklyWinners
		.filter((item) => item.xp >= ACTIVE_THRESHOLD_ONE)
		.map((item) => item.user);
	if (config.roles.active) {
		const activeMembers = new Set([
			...latestActiveMembers,
			...Object.entries(
				recentXpDatabase.data.reduce<Record<Snowflake, number>>((accumulator, gain) => {
					accumulator[gain.user] = (accumulator[gain.user] ?? 0) + gain.xp;
					return accumulator;
				}, {}),
			)
				.filter(([, xp]) => xp >= ACTIVE_THRESHOLD_TWO)
				.map((entry) => entry[0]),
		]);
		for (const [, member] of config.roles.active.members)
			if (!activeMembers.has(member.id))
				await member.roles.remove(config.roles.active, "Inactive");
	}

	recentXpDatabase.data = recentXpDatabase.data.filter(
		(entry) => entry.time + 604_800_000 > Date.now(),
	);

	// Determine stats and the winners
	const allXp = Math.floor(weeklyWinners.reduce((one, two) => one + two.xp, 0));
	const chatters = weeklyWinners.length;
	weeklyWinners.splice(
		weeklyWinners.findIndex(
			(gain, index) => index > 3 && gain.xp !== weeklyWinners[index + 1]?.xp,
		) + 1 || weeklyWinners.length,
	);

	// Send weekly
	const winners = weeklyWinners
		.map(
			(gain, index) =>
				`${["🥇", "🥈", "🥉"][index] ?? "🏅"} ${userMention(
					gain.user,
				)} - ${Math.floor(gain.xp).toLocaleString()} XP`,
		)
		.join("\n");
	const stats = `*This week, ${chatters.toLocaleString()} people chatted, and ${latestActiveMembers.length.toLocaleString()} people were active. Altogether, people gained ${allXp.toLocaleString()} XP this week.*`;
	const nextWeek = `### Next week’s weekly winners will be posted ${time(
		date,
		TimestampStyles.RelativeTime,
	)}.`;
	return `${title}\n${winners || "*Nobody got any XP this week!*"}\n\n${stats}\n${nextWeek}`;
}
