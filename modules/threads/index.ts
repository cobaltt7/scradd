import { defineButton, defineEvent, defineSubcommands } from "strife.js";
import { ApplicationCommandOptionType, roleMention, ChannelType } from "discord.js";
import { syncMembers, updateMemberThreads, updateThreadMembers } from "../threads/syncMembers.js";
import { autoClose, cancelThreadChange, setUpAutoClose } from "../threads/autoClose.js";
import { getThreadConfig } from "./misc.js";
import { paginate } from "../../util/discord.js";

defineEvent("threadCreate", async (thread) => {
	if (thread.type === ChannelType.PrivateThread) return;
	const { roles } = getThreadConfig(thread);
	if (roles.length)
		await thread.send({
			content: roles.map(roleMention).join(""),
			allowedMentions: { parse: ["roles"] },
		});
});

defineSubcommands(
	{
		name: "thread",
		description: "Commands to manage threads",
		restricted: true,
		subcommands: {
			"close-in": {
				description: "Close this thread after a specified amount of time",
				options: {
					time: {
						type: ApplicationCommandOptionType.String,
						required: true,
						description:
							"How long until closing the thread, a UNIX timestamp to close it at, or “never”",
					},
				},
			},
			"lock-in": {
				description: "Lock this thread after a specified amount of time",
				options: {
					time: {
						type: ApplicationCommandOptionType.String,
						required: true,
						description:
							"How long until locking the thread or a UNIX timestamp to lock it at",
					},
				},
			},
			"sync-members": {
				description: "Automatically sync members of a role with members of this thread",
				options: {
					role: {
						type: ApplicationCommandOptionType.Role,
						required: true,
						description: "The role to add or remove from this thread",
					},
				},
			},
			"list-unjoined": {
				description: "List active threads that you are not in",
				options: {},
			},
		},
	},
	async (interaction, options) => {
		switch (options.subcommand) {
			case "sync-members": {
				return syncMembers(interaction, options.options);
			}
			case "list-unjoined": {
				await interaction.deferReply({ ephemeral: true });
				const fetched = await interaction.guild?.channels.fetchActiveThreads();
				const threads = await Promise.all(
					fetched?.threads.map(
						async (thread) =>
							[
								thread,
								await thread.members.fetch(interaction.user.id).catch(() => void 0),
							] as const,
					) ?? [],
				);
				const unjoined = threads
					.filter(
						([thread, joined]) =>
							!joined && thread.permissionsFor(interaction.user)?.has("ViewChannel"),
					)
					.sort(
						([one], [two]) =>
							(one.parent?.rawPosition ?? 0) - (two.parent?.rawPosition ?? 0) ||
							(one.parent?.position ?? 0) - (two.parent?.position ?? 0),
					);
				await paginate(
					unjoined,
					([thread]) => thread.parent?.toString() + " > " + thread.toString(),
					(data) => interaction.editReply(data),
					{
						title: "Unjoined Threads",
						singular: "thread",
						failMessage: "You’ve joined all the threads here!",
						user: interaction.user,
						ephemeral: true,
						totalCount: unjoined.length,
					},
				);
				return;
			}
			default: {
				await setUpAutoClose(interaction, options);
			}
		}
	},
);

defineButton("cancelThreadChange", cancelThreadChange);
defineEvent("threadUpdate", autoClose);

defineEvent("guildMemberUpdate", updateMemberThreads);
defineEvent("threadUpdate", updateThreadMembers);
