---
name: ha-control
description: Control Home Assistant smart home devices, check device states, and schedule future automations
user-invocable: false
command-dispatch: tool
---

# Home Assistant Control

You have access to the user's Home Assistant smart home. A list of known devices is injected into your context at the start of each conversation under the `[Home Assistant Devices]` section.

## Device Resolution

The user will refer to devices by their friendly name, room, or even loose descriptions. Use the `[Home Assistant Devices]` context to map what the user says to the correct `entity_id`. Examples:
- "the kitchen light" → look for a light entity in the Kitchen room
- "donut lamp" or "lamp shaped like a donut" → match semantically to the closest name
- If you cannot confidently identify a single device, call `ha_list_entities` to show the user the options and ask for clarification.

Never guess an `entity_id` — always resolve it from the device registry or ask the user.

## Checking State

Before acting on a device, you may want to know its current state. Use `ha_get_states` with the specific `entity_id`. Skip this if the user's intent is unambiguous (e.g. "turn off the lights" does not require knowing if they are already off).

## Controlling Devices

Use `ha_call_service` with the appropriate `domain`, `service`, and `entity_id`. Common service patterns:

| Domain | On | Off | Toggle | Other |
|---|---|---|---|---|
| `light` | `turn_on` | `turn_off` | `toggle` | `turn_on` with `brightness_pct` (0-100) or `color_name` |
| `switch` | `turn_on` | `turn_off` | `toggle` | |
| `cover` | `open_cover` | `close_cover` | `toggle` | `set_cover_position` with `position` (0-100) |
| `climate` | `turn_on` | `turn_off` | | `set_temperature` with `temperature`, `set_hvac_mode` with `hvac_mode` |
| `lock` | `unlock` | `lock` | | |
| `media_player` | `media_play` | `media_pause` | | `volume_set` with `volume_level` (0.0-1.0) |

After every successful action, confirm to the user what you did in natural language. Example: "Done — turned the kitchen ceiling light to 40% brightness."

## Scheduling Future Actions

When a user asks to do something at a specific time or after a delay:

1. Convert the time to ISO 8601 format yourself before calling the tool (e.g. "tonight at 11" → `2025-06-01T23:00:00`).
2. Call `ha_schedule_action` with `when` (ISO 8601), `domain`, `service`, `entity_id`, and an optional descriptive `label`.
3. The tool registers the cron job directly — **do not call `cron.add` afterwards**.
4. Confirm to the user: "Scheduled — I'll turn off the garden lights at 23:00 tonight."

## Multiple Devices

If the user refers to multiple devices at once (e.g. "turn off all the lights"), call `ha_call_service` once per device. Keep the user informed with a summary response.

## Unknown or Disabled Devices

If `ha_call_service` returns an error saying a device is disabled, inform the user that the device is excluded from agent control. They can edit the relevant YAML file in their workspace `ha/` folder to re-enable it.
