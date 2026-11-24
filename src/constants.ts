export const VIEW_TYPE = "tracky-dashboard";

// Directories
export const ROOT = "Tracky";
export const BACKLOG = `${ROOT}/Backlog`;
export const WORK = `${ROOT}/Work-dir`;
export const ARCHIVE = `${ROOT}/Archive`;
export const TEMPLATE = `${ROOT}/TRACKY_TASK_TEMPLATE.md`;
export const STATUSES = ["Open", "In_Progress", "Done"];
export const STATUS_STAGE: Record<string, number> = { Open: 0, In_Progress: 1, Done: 2 };

// Tags
export const TAG_TODO = "#tracky-task-to-do";
export const TAG_PROGRESS = "#tracky-task-in-progress";
export const TAG_DONE = "#tracky-task-done";
export const TAG_ARCHIVE = "#tracky-task-archive";
export const TAG_STAGE: Record<string, number> = {
	[TAG_TODO]: 0,
	[TAG_PROGRESS]: 1,
	[TAG_DONE]: 2,
};

// Allowed values:
//  priority: Low | Medium | High
//  status:   Open | In_Progress | Done
//  dow:      Mon | Tue | Wed | Thu | Fri | Sat | Sun
export const TEMPLATE_CONTENT = `---
tracky.task-priority: Medium
tracky.task-status: Open
tracky.days-planned:
tracky.days-spent:
tracky.task-description:
tracky.task-mandatory-date:
tracky.task-mandatory-dow:
tags:
  - tracky-task-to-do
---
#### Task

---
#### Links
`;

export const COLUMNS = [
	{ key: "Open", title: "TO DO" },
	{ key: "In_Progress", title: "IN PROGRESS" },
	{ key: "Done", title: "DONE" },
];

export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
