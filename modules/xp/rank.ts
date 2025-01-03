import type {
	ButtonInteraction,
	ChatInputCommandInteraction,
	GuildMember,
	InteractionResponse,
	RepliableInteraction,
	User,
} from "discord.js";

import { ButtonStyle, ComponentType } from "discord.js";
import { paginate, zeroWidthSpace } from "strife.js";

import config from "../../common/config.ts";
import constants from "../../common/constants.ts";
import features from "../../common/features.ts";
import { getAllMembers } from "../../util/discord.ts";
import { nth } from "../../util/numbers.ts";
import { getSettings, mentionUser } from "../settings.ts";
import { getLevelForXp, getXpForLevel } from "./misc.ts";
import { getFullWeeklyData, xpDatabase } from "./util.ts";

export default async function getUserRank(
	interaction: RepliableInteraction,
	user: User,
): Promise<void> {
	const allXp = xpDatabase.data.toSorted((one, two) => two.xp - one.xp);

	const member = await config.guild.members.fetch(user.id).catch(() => void 0);

	const xp = allXp.find((entry) => entry.user === user.id)?.xp ?? 0;
	const level = getLevelForXp(xp);
	const xpForNextLevel = getXpForLevel(level + 1);
	const xpForPreviousLevel = getXpForLevel(level);
	const increment = xpForNextLevel - xpForPreviousLevel;
	const xpGained = xp - xpForPreviousLevel;
	const progress = xpGained / increment;
	const rank = allXp.findIndex((info) => info.user === user.id) + 1;
	const weeklyRank = getFullWeeklyData().findIndex((entry) => entry.user === user.id) + 1;
	const approximateWeeklyRank = Math.ceil(weeklyRank / 10) * 10;

	const guildMembers = await getAllMembers(config.guild);
	const guildRank =
		allXp
			.filter((entry) => guildMembers.has(entry.user))
			.findIndex((entry) => entry.user === user.id) + 1;
	const rankInfo =
		rank &&
		`Ranked ${rank.toLocaleString()}/${allXp.length.toLocaleString()}${
			guildRank ?
				` (${guildRank.toLocaleString()}/${guildMembers.size.toLocaleString()} in the server)`
			:	""
		}`;

	await interaction.reply({
		embeds: [
			{
				author: {
					icon_url: (member ?? user).displayAvatarURL(),
					name: (member ?? user).displayName,
				},

				fields: [
					{ name: "📊 Level", value: level.toLocaleString(), inline: true },
					{ name: "✨ XP", value: Math.floor(xp).toLocaleString(), inline: true },
					{
						name: "⏳ Weekly rank",

						value:
							weeklyRank ?
								approximateWeeklyRank === 10 ?
									"Top 10"
								:	`About ${nth(Math.max(0, approximateWeeklyRank - 5))}`
							:	"Inactive this week",

						inline: true,
					},
					{
						name: zeroWidthSpace,
						value: `**⬆️ Next level progress** ${xpForNextLevel.toLocaleString()} XP needed`,
					},
				],

				color: member?.displayColor,
				title: "XP Rank",
				footer: rankInfo ? { text: rankInfo } : undefined,
				image: { url: "attachment://progress.png" },
			},
		],

		components: [
			{
				components: [
					{
						type: ComponentType.Button,
						customId: `${user.id}_viewLeaderboard`,
						label: "Leaderboard",
						style: ButtonStyle.Primary,
					},
				],
				type: ComponentType.ActionRow,
			},
		],

		files: await makeCanvasFiles(progress),
		ephemeral:
			interaction.isButton() &&
			interaction.message.interactionMetadata?.user.id !== interaction.user.id,
	});
}

async function makeCanvasFiles(progress: number): Promise<{ attachment: Buffer; name: string }[]> {
	if (!features._canvas) return [];

	const { createCanvas } = await import("@napi-rs/canvas");
	const canvas = createCanvas(1000, 50);
	const context = canvas.getContext("2d");
	context.fillStyle = "#0003";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = `#${constants.themeColor.toString(16)}`;
	const rectangleSize = canvas.width * progress;
	const paddingPixels = 0.18 * canvas.height;
	context.fillRect(0, 0, rectangleSize, canvas.height);
	context.font = `${canvas.height * 0.9}px ${constants.fonts}`;
	if (progress < 0.145) {
		context.fillStyle = "#666";
		context.textAlign = "end";
		context.fillText(
			progress.toLocaleString([], { maximumFractionDigits: 1, style: "percent" }),
			canvas.width - paddingPixels,
			canvas.height - paddingPixels,
		);
	} else {
		context.fillStyle = "#0009";
		context.fillText(
			progress.toLocaleString([], { maximumFractionDigits: 1, style: "percent" }),
			paddingPixels,
			canvas.height - paddingPixels,
		);
	}
	return [{ attachment: canvas.toBuffer("image/png"), name: "progress.png" }];
}

export async function top(
	interaction: ButtonInteraction | ChatInputCommandInteraction<"cached" | "raw">,
	user?: GuildMember | User,
	onlyMembers = false,
): Promise<InteractionResponse | undefined> {
	const leaderboard = xpDatabase.data.toSorted((one, two) => two.xp - one.xp);

	const index = user && leaderboard.findIndex(({ user: id }) => id === user.id);
	if (user && index === -1)
		return await interaction.reply({
			content: `${
				constants.emojis.statuses.no
			} ${user.toString()} could not be found! Do they have any XP?`,

			ephemeral: true,
		});

	const message = await interaction.deferReply({
		ephemeral:
			interaction.isButton() &&
			interaction.message.interactionMetadata?.user.id !== interaction.user.id,
		fetchReply: true,
	});
	const guildMembers = onlyMembers && (await getAllMembers(config.guild));

	await paginate(
		guildMembers ? leaderboard.filter((entry) => guildMembers.has(entry.user)) : leaderboard,
		async (xp) =>
			`${await mentionUser(xp.user, interaction.user)} - Level ${getLevelForXp(
				xp.xp,
			)} (${Math.floor(xp.xp).toLocaleString()} XP)`,
		(data) => message.edit(data),
		{
			title: "XP Leaderboard",
			singular: "user",

			user: interaction.user,
			rawOffset: index,
			pageLength: 15,

			timeout: constants.collectorTime,
			color: constants.themeColor,

			async generateComponents() {
				return (await getSettings(interaction.user, false)).useMentions === undefined ?
						[
							{
								customId: `useMentions-${interaction.user.id}_toggleSetting`,
								type: ComponentType.Button,
								label: "Toggle Mentions",
								style: ButtonStyle.Success,
							},
						]
					:	undefined;
			},
			customComponentLocation: "below",
		},
	);
}
