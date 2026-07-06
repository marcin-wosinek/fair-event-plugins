import { __ } from '@wordpress/i18n';

// Serialize one answer to markdown lines (### heading + value/link).
function answerToMarkdownLines(answer) {
	const lines = [`### ${answer.question_text}`, ''];

	if (answer.file_url) {
		const alt = answer.question_text || '';
		// is_image comes from the server mime check — single source of truth.
		lines.push(
			answer.is_image
				? `![${alt}](${answer.file_url})`
				: `[${alt}](${answer.file_url})`
		);
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
