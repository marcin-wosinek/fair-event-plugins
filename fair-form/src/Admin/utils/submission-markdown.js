import { __ } from '@wordpress/i18n';

// Markdown for a file_upload answer: an embedded image when the attachment
// is an image, otherwise a plain link. `is_image` comes from the server mime
// check — single source of truth. Returns null when the answer has no file.
export function fileAnswerMarkdown(answer) {
	if (!answer?.file_url) {
		return null;
	}
	const alt = answer.question_text || '';
	return answer.is_image
		? `![${alt}](${answer.file_url})`
		: `[${alt}](${answer.file_url})`;
}

// Serialize one answer to markdown lines (### heading + value/link).
function answerToMarkdownLines(answer) {
	const lines = [`### ${answer.question_text}`, ''];

	const fileMarkdown = fileAnswerMarkdown(answer);
	if (fileMarkdown) {
		lines.push(fileMarkdown);
	} else if (answer.question_type === 'multiselect' && answer.answer_value) {
		let value = answer.answer_value;
		try {
			const parsed = JSON.parse(answer.answer_value);
			if (Array.isArray(parsed)) {
				value = parsed.join(', ');
			}
		} catch {
			// Keep the raw value.
		}
		lines.push(value);
	} else if (answer.question_type === 'checkbox') {
		lines.push(
			answer.answer_value === '1'
				? __('Yes', 'fair-audience')
				: __('No', 'fair-audience')
		);
	} else {
		lines.push(answer.answer_value || '');
	}

	return lines;
}

// One submission → markdown block (## respondent, submitted date, answers).
// No leading `---` separator; callers add that when listing multiple.
export function submissionToMarkdown(submission) {
	const submittedLabel = __('Submitted', 'fair-audience');
	const adminBase = `${window.location.origin}${window.location.pathname}`;

	const respondent =
		submission.participant_name ||
		submission.participant_email ||
		`#${submission.id}`;

	const lines = [];
	if (submission.participant_id) {
		const participantUrl = `${adminBase}?page=fair-audience-participant-detail&participant_id=${submission.participant_id}`;
		lines.push(`## [${respondent}](${participantUrl})`);
	} else {
		lines.push(`## ${respondent}`);
	}
	lines.push('');

	if (submission.created_at) {
		lines.push(`_${submittedLabel} ${submission.created_at}_`);
		lines.push('');
	}

	(submission.answers || []).forEach((answer) => {
		lines.push(...answerToMarkdownLines(answer));
		lines.push('');
	});

	return lines.join('\n');
}
