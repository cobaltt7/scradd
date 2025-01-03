import type {
	InteractionReplyOptions,
	RepliableInteraction,
	Snowflake,
	UserMention,
} from "discord.js";
import type { BasicOption } from "strife.js";
import type { CamelToKebab } from "../util/text.ts";

import {
	ApplicationCommandOptionType,
	ButtonStyle,
	ComponentType,
	hyperlink,
	User,
	userMention,
} from "discord.js";
import { client, defineButton, defineChatCommand, disableComponents } from "strife.js";

import config from "../common/config.ts";
import constants from "../common/constants.ts";
import Database from "../common/database.ts";
import { getWeeklyXp } from "./xp/util.ts";

/**
 * ## How to add a setting
 *
 * 1. Add it to the {@link SETTINGS} object. The key is the name in camelCase and the value is in Title Case.
 * 2. Add a default value for the setting in the {@link getDefaultSettings} function. This is enforced by the types.
 * 3. Add the option to the `/settings` commands as desired. Name the option the same, but kebab-cased. The types enforce
 *    correct casing.
 * 4. Add buttons in {@link updateSettings} as desired to toggle this setting.
 */
const SETTINGS = {
	boardPings: "Board Pings",
	dmReminders: "DM Reminders",
	levelUpPings: "Level Up Pings",
	scratchEmbeds: "Scratch Link Embeds",
	useMentions: "Use Mentions",
} as const;
export async function getDefaultSettings(user: {
	id: Snowflake;
}): Promise<Required<Omit<(typeof userSettingsDatabase.data)[number], "id">>> {
	const member = await config.guild.members.fetch(user.id).catch(() => void 0);
	const isDev =
		(await config.guilds.development.members?.fetch(user.id).then(
			() => true,
			() => false,
		)) ?? !member;
	return {
		boardPings: constants.env === "production",
		dmReminders: true,
		execute: false,
		levelUpPings: constants.env === "production",
		scraddChat: false,
		scratchEmbeds: true,
		useMentions: getWeeklyXp(user.id) > 100 || isDev,
	};
}

defineChatCommand(
	{
		name: "settings",
		description: "Customize your personal settings",

		options: {
			"board-pings": {
				type: ApplicationCommandOptionType.Boolean,
				description: `Ping you when your messages get on ${
					config.channels.board ? `#${config.channels.board.name}` : "the board"
				}`,
			},
			"dm-reminders": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Send reminders in your DMs by default",
			},
			"level-up-pings": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Ping you when you level up",
			},
			"scratch-embeds": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Show information about Scratch links you send",
			},
			"use-mentions": {
				type: ApplicationCommandOptionType.Boolean,
				description:
					"Use mentions instead of usernames in embeds so you can view profiles (prone to Discord glitches)",
			},
		} satisfies Partial<Record<CamelToKebab<keyof typeof SETTINGS>, BasicOption>>,
	},
	settingsCommand,
);
defineChatCommand(
	{
		name: "settings",
		description: "Customize personal settings",
		access: config.otherGuildIds,

		options: {
			"board-pings": {
				type: ApplicationCommandOptionType.Boolean,
				description: `Pings you when your messages get on ${
					config.channels.board ? `#${config.channels.board.name}` : "the board"
				} in the community server`,
			},
			"dm-reminders": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Send reminders in your DMs by default",
			},
			"scratch-embeds": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Show information about Scratch links you send",
			},
			"use-mentions": {
				type: ApplicationCommandOptionType.Boolean,
				description: "Replace mentions with usernames in embeds to avoid seeing raw IDs",
			},
		} satisfies Partial<Record<CamelToKebab<keyof typeof SETTINGS>, BasicOption>>,
	},
	settingsCommand,
);

async function settingsCommand(
	interaction: RepliableInteraction,
	options: Partial<Record<CamelToKebab<keyof typeof SETTINGS>, boolean | undefined>>,
): Promise<void> {
	const newOptions = Object.fromEntries(
		Object.entries(options).map(([option, value]) => [
			option.replaceAll(/-./g, (match) => match[1]?.toUpperCase() ?? ""),
			value,
		]),
	);
	await interaction.reply(await updateSettings(interaction.user, newOptions));
}
export async function updateSettings(
	user: User,
	settings: Partial<Record<keyof typeof SETTINGS, boolean | "toggle" | undefined>>,
): Promise<InteractionReplyOptions> {
	const old = await getSettings(user);
	const updated = {
		id: user.id,
		...Object.fromEntries(
			Object.keys(SETTINGS).map((setting) => {
				const value = settings[setting];
				return [setting, value === "toggle" ? !old[setting] : (value ?? old[setting])];
			}),
		),
	};

	userSettingsDatabase.updateById(updated, old);

	const buttons = Object.fromEntries(
		Object.entries(SETTINGS).map(([setting, label]) => [
			setting,
			{
				customId: `${setting}-${user.id}_toggleSetting`,
				label,
				style: ButtonStyle[updated[setting] ? "Success" : "Danger"],
				type: ComponentType.Button,
			} as const,
		]),
	);

	return {
		components: [
			{
				components: [
					buttons.dmReminders,
					...(await config.guild.members.fetch(user.id).then(
						() => [buttons.boardPings, buttons.levelUpPings],
						() => [],
					)),
				],
				type: ComponentType.ActionRow,
			},
			{
				components: [buttons.useMentions, buttons.scratchEmbeds],
				type: ComponentType.ActionRow,
			},
		],

		content: `${constants.emojis.statuses.yes} Updated your settings!`,
		ephemeral: true,
	};
}

defineButton("toggleSetting", async (interaction, data) => {
	const [setting, id] = data.split("-");
	if (interaction.user.id !== id)
		return await interaction.reply({
			ephemeral: true,
			content: `${
				constants.emojis.statuses.no
			} You don’t have permission to update other people’s settings!`,
		});

	await interaction.reply(await updateSettings(interaction.user, { [setting]: "toggle" }));

	if (!interaction.message.flags.has("Ephemeral"))
		await interaction.message.edit({
			components: disableComponents(interaction.message.components),
		});
});

export const userSettingsDatabase = new Database<
	{ id: Snowflake; execute?: boolean; scraddChat?: boolean } & {
		[key in keyof typeof SETTINGS]?: boolean;
	}
>("user_settings");
await userSettingsDatabase.init();
export async function getSettings(
	user: { id: Snowflake },
	defaults?: true,
): Promise<Required<(typeof userSettingsDatabase.data)[number]>>;
export async function getSettings(
	user: { id: Snowflake },
	defaults: false,
): Promise<(typeof userSettingsDatabase.data)[number]>;
export async function getSettings(
	user: { id: Snowflake },
	defaults = true,
): Promise<(typeof userSettingsDatabase.data)[number]> {
	return {
		id: user.id,
		...(defaults && (await getDefaultSettings(user))),
		...userSettingsDatabase.data.find((settings) => settings.id === user.id),
	};
}

export async function mentionUser(
	user: Snowflake | User,
	interactor?: { id: Snowflake },
): Promise<UserMention | `[${string}](${string})`> {
	const useMentions = interactor && (await getSettings(interactor)).useMentions;
	const id = user instanceof User ? user.id : user;
	if (useMentions) return userMention(id);

	const presence = interactor && config.guild.presences.resolve(interactor.id);
	const url = `<${
		presence && !presence.clientStatus?.mobile && !presence.clientStatus?.web ?
			"discord://-"
		:	"https://discord.com"
	}/users/${id}>`;

	const { displayName } =
		user instanceof User ? user : ((await client.users.fetch(user).catch(() => void 0)) ?? {});
	return displayName ? hyperlink(displayName, url) : userMention(id);
}
