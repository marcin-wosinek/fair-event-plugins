/**
 * @jest-environment jsdom
 */
import {
	evaluateConditionals,
	getQuestionValue,
	collectQuestionAnswers,
	validateQuestions,
	isValidPhoneNumber,
	PHONE_HTML_PATTERN,
} from '../questionnaire.js';

const VISIBLE = 'fair-form-conditional-visible';

/**
 * Build an option checkbox as the Event Signup render.php emits it.
 *
 * @param {Object}  opts            Checkbox config.
 * @param {string}  opts.name       Field name (ticket_option_ids[] or add_option_ids[]).
 * @param {string}  opts.shortName  data-option-short-name value.
 * @param {boolean} opts.checked    Whether it starts checked.
 * @return {string} The input markup.
 */
function optionCheckbox({ name, shortName, checked }) {
	return `<input type="checkbox" name="${name}" value="1" data-option-short-name="${shortName}"${
		checked ? ' checked' : ''
	} />`;
}

/**
 * Build a conditional section keyed on an event option.
 *
 * @param {Object} opts            Section config.
 * @param {string} opts.shortName  conditionOptionShortName (omit for the empty case).
 * @param {string} opts.operator   selected | not_selected.
 * @param {string} opts.inner      Inner HTML.
 * @return {string} The section markup.
 */
function eventOptionSection({
	shortName = '',
	operator = 'selected',
	inner = '',
}) {
	return `<div data-fair-form-conditional data-condition-source="eventOption" data-condition-operator="${operator}" data-condition-option-short-name="${shortName}">${inner}</div>`;
}

/**
 * Render markup into a detached <form> and run evaluateConditionals on it.
 *
 * @param {string} html Form inner HTML.
 * @return {HTMLFormElement} The form element.
 */
function buildForm(html) {
	const form = document.createElement('form');
	form.innerHTML = html;
	document.body.appendChild(form);
	evaluateConditionals(form);
	return form;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('evaluateConditionals — eventOption source', () => {
	it('shows the section when the matching option is selected', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'dinner',
				checked: true,
			}) +
				eventOptionSection({
					shortName: 'dinner',
					operator: 'selected',
				})
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('hides the section when the matching option is not selected', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'dinner',
				checked: false,
			}) +
				eventOptionSection({
					shortName: 'dinner',
					operator: 'selected',
				})
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});

	it('inverts visibility for the not_selected operator', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'dinner',
				checked: false,
			}) +
				eventOptionSection({
					shortName: 'dinner',
					operator: 'not_selected',
				})
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('matches options in the "add activities" fieldset too', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'add_option_ids[]',
				shortName: 'dinner',
				checked: true,
			}) +
				eventOptionSection({
					shortName: 'dinner',
					operator: 'selected',
				})
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('hides the section when the short name is empty', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'dinner',
				checked: true,
			}) + eventOptionSection({ shortName: '', operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});

	it('keeps an inner section hidden when its parent conditional is hidden, even if its option is selected', () => {
		// Outer conditional is keyed on a different, unselected option, so it
		// stays hidden; the inner one is keyed on a selected option but must
		// remain hidden because of the hidden ancestor.
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'breakfast',
				checked: false,
			}) +
				optionCheckbox({
					name: 'ticket_option_ids[]',
					shortName: 'dinner',
					checked: true,
				}) +
				eventOptionSection({
					shortName: 'breakfast',
					operator: 'selected',
					inner: eventOptionSection({
						shortName: 'dinner',
						operator: 'selected',
					}),
				})
		);
		const [outer, inner] = form.querySelectorAll(
			'[data-fair-form-conditional]'
		);
		expect(outer.classList.contains(VISIBLE)).toBe(false);
		expect(inner.classList.contains(VISIBLE)).toBe(false);
	});

	it('shows a nested section when both its option and its ancestor are visible', () => {
		const form = buildForm(
			optionCheckbox({
				name: 'ticket_option_ids[]',
				shortName: 'breakfast',
				checked: true,
			}) +
				optionCheckbox({
					name: 'ticket_option_ids[]',
					shortName: 'dinner',
					checked: true,
				}) +
				eventOptionSection({
					shortName: 'breakfast',
					operator: 'selected',
					inner: eventOptionSection({
						shortName: 'dinner',
						operator: 'selected',
					}),
				})
		);
		const [outer, inner] = form.querySelectorAll(
			'[data-fair-form-conditional]'
		);
		expect(outer.classList.contains(VISIBLE)).toBe(true);
		expect(inner.classList.contains(VISIBLE)).toBe(true);
	});
});

/**
 * Build a ticket type radio as the Event Signup render.php emits it.
 *
 * @param {Object}  opts         Radio config.
 * @param {number}  opts.id      Ticket type ID (radio value).
 * @param {boolean} opts.checked Whether it starts checked.
 * @return {string} The input markup.
 */
function ticketTypeRadio({ id, checked }) {
	return `<input type="radio" name="ticket_type_id" value="${id}"${
		checked ? ' checked' : ''
	} />`;
}

/**
 * Build a conditional section keyed on the selected ticket type.
 *
 * @param {Object} opts           Section config.
 * @param {Array}  opts.ids       conditionTicketTypeIds (as a JS array, JSON-encoded here).
 * @param {string} opts.operator  selected | not_selected.
 * @param {string} opts.inner     Inner HTML.
 * @return {string} The section markup.
 */
function ticketTypeSection({ ids = [], operator = 'selected', inner = '' }) {
	return `<div data-fair-form-conditional data-condition-source="ticketType" data-condition-operator="${operator}" data-condition-ticket-type-ids='${JSON.stringify(
		ids
	)}'>${inner}</div>`;
}

describe('evaluateConditionals — ticketType source', () => {
	it('shows the section when the matching ticket type is selected', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: true }) +
				ticketTypeRadio({ id: 2, checked: false }) +
				ticketTypeSection({ ids: [1], operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('hides the section when a different ticket type is selected', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: false }) +
				ticketTypeRadio({ id: 2, checked: true }) +
				ticketTypeSection({ ids: [1], operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});

	it('inverts visibility for the not_selected operator', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: false }) +
				ticketTypeRadio({ id: 2, checked: true }) +
				ticketTypeSection({ ids: [1], operator: 'not_selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('OR-matches when multiple ticket type IDs are referenced', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: false }) +
				ticketTypeRadio({ id: 2, checked: true }) +
				ticketTypeSection({ ids: [1, 2], operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('hides the section when no ticket types are referenced', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: true }) +
				ticketTypeSection({ ids: [], operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});

	it('hides the section when no ticket type is selected at all', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: false }) +
				ticketTypeSection({ ids: [1], operator: 'selected' })
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});

	it('keeps an inner section hidden when its parent conditional is hidden, even if its ticket type is selected', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: false }) +
				ticketTypeRadio({ id: 2, checked: true }) +
				ticketTypeSection({
					ids: [1],
					operator: 'selected',
					inner: ticketTypeSection({
						ids: [2],
						operator: 'selected',
					}),
				})
		);
		const [outer, inner] = form.querySelectorAll(
			'[data-fair-form-conditional]'
		);
		expect(outer.classList.contains(VISIBLE)).toBe(false);
		expect(inner.classList.contains(VISIBLE)).toBe(false);
	});

	it('shows a nested section when both its ticket type and its ancestor are visible', () => {
		const form = buildForm(
			ticketTypeRadio({ id: 1, checked: true }) +
				ticketTypeSection({
					ids: [1],
					operator: 'selected',
					inner: ticketTypeSection({
						ids: [1],
						operator: 'selected',
					}),
				})
		);
		const [outer, inner] = form.querySelectorAll(
			'[data-fair-form-conditional]'
		);
		expect(outer.classList.contains(VISIBLE)).toBe(true);
		expect(inner.classList.contains(VISIBLE)).toBe(true);
	});
});

describe('evaluateConditionals — question source (regression)', () => {
	it('still shows a question-keyed section when its answer matches', () => {
		const form = buildForm(
			`<div data-fair-form-question data-question-key="color" data-question-type="short_text"><input type="text" value="blue" /></div>` +
				`<div data-fair-form-conditional data-condition-source="question" data-condition-question-key="color" data-condition-operator="equals" data-condition-value="blue"></div>`
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(true);
	});

	it('treats a missing conditionSource as the question source', () => {
		const form = buildForm(
			`<div data-fair-form-question data-question-key="color" data-question-type="short_text"><input type="text" value="red" /></div>` +
				`<div data-fair-form-conditional data-condition-question-key="color" data-condition-operator="equals" data-condition-value="blue"></div>`
		);
		const section = form.querySelector('[data-fair-form-conditional]');
		expect(section.classList.contains(VISIBLE)).toBe(false);
	});
});

/**
 * Build a long-text question wrapped in a conditional section keyed on a
 * short-text "color" question.
 *
 * @param {string} colorValue The color question's current value.
 * @return {string} The markup.
 */
function conditionalLongTextQuestion(colorValue) {
	return (
		`<div data-fair-form-question data-question-key="color" data-question-type="short_text"><input type="text" value="${colorValue}" /></div>` +
		`<div data-fair-form-conditional data-condition-source="question" data-condition-question-key="color" data-condition-operator="equals" data-condition-value="blue">` +
		`<div data-fair-form-question data-question-key="details" data-question-type="long_text"><textarea></textarea></div>` +
		`</div>`
	);
}

describe('evaluateConditionals — long-text autosize on reveal', () => {
	// jsdom performs no real layout, so scrollHeight is always 0 unless mocked.
	it('autosizes a long-text textarea once its conditional section becomes visible', () => {
		const form = buildForm(conditionalLongTextQuestion('blue'));
		const textarea = form.querySelector('textarea');
		Object.defineProperty(textarea, 'scrollHeight', {
			configurable: true,
			value: 120,
		});

		evaluateConditionals(form);

		expect(textarea.style.height).toBe('120px');
	});

	it('leaves a long-text textarea unsized while its conditional section stays hidden', () => {
		const form = buildForm(conditionalLongTextQuestion('red'));
		const textarea = form.querySelector('textarea');
		Object.defineProperty(textarea, 'scrollHeight', {
			configurable: true,
			value: 120,
		});

		evaluateConditionals(form);

		expect(textarea.style.height).not.toBe('120px');
	});
});

function consentQuestion({ checked = false, required = true } = {}) {
	return (
		`<div data-fair-form-question data-question-key="tos" data-question-text="I accept" data-question-type="checkbox" data-required="${
			required ? '1' : '0'
		}">` +
		`<input type="checkbox" name="fair_form_q_tos" value="1"${
			checked ? ' checked' : ''
		} /></div>`
	);
}

describe('checkbox question type', () => {
	describe('getQuestionValue', () => {
		it('returns "1" when the checkbox is checked', () => {
			const form = buildForm(consentQuestion({ checked: true }));
			const questionEl = form.querySelector('[data-fair-form-question]');
			expect(getQuestionValue(questionEl)).toBe('1');
		});

		it('returns "0" when the checkbox is unchecked', () => {
			const form = buildForm(consentQuestion({ checked: false }));
			const questionEl = form.querySelector('[data-fair-form-question]');
			expect(getQuestionValue(questionEl)).toBe('0');
		});
	});

	describe('collectQuestionAnswers', () => {
		it('stores "1" for a checked box', () => {
			const form = buildForm(consentQuestion({ checked: true }));
			const answers = collectQuestionAnswers(form);
			expect(answers).toHaveLength(1);
			expect(answers[0].answer_value).toBe('1');
		});

		it('stores "0" for an unchecked box, not the input value attribute', () => {
			const form = buildForm(consentQuestion({ checked: false }));
			const answers = collectQuestionAnswers(form);
			expect(answers).toHaveLength(1);
			expect(answers[0].answer_value).toBe('0');
		});
	});

	describe('validateQuestions', () => {
		it('blocks submission when a required consent box is unchecked', () => {
			const form = buildForm(
				consentQuestion({ checked: false, required: true })
			);
			expect(validateQuestions(form)).toMatch(/I accept/);
		});

		it('passes when a required consent box is checked', () => {
			const form = buildForm(
				consentQuestion({ checked: true, required: true })
			);
			expect(validateQuestions(form)).toBeNull();
		});

		it('does not require an unchecked box when required is false', () => {
			const form = buildForm(
				consentQuestion({ checked: false, required: false })
			);
			expect(validateQuestions(form)).toBeNull();
		});
	});
});

/**
 * Build a phone question as fair-form-phone/render.php emits it.
 *
 * @param {string} value Field value.
 * @return {string} The question markup.
 */
function phoneQuestion(value) {
	return (
		'<div data-fair-form-question data-question-key="mobile" data-question-text="Mobile" data-question-type="phone" data-required="0">' +
		`<input type="tel" value="${value}" /></div>`
	);
}

describe('phone question type', () => {
	// One separator per accept case is enough to prove the class is
	// accepted anywhere between the leading `+` and the last digit; the
	// browser pattern and isValidPhoneNumber() must agree on every case.
	const ACCEPT = [
		'+491701234567',
		'+49 170 123 45 67',
		'+49-170-123-45-67',
		'+49.170.123.4567',
		'+49 (170) 1234567',
		'+49 170 123 45 67', // NBSP
		'+49 170 1234567', // narrow NBSP
	];

	const REJECT = [
		'49 170 1234567',
		'+49 17a 1234',
		'++49 1701234',
		'+ - . ( )',
		'+0491701234567',
		'+491234', // 6 digits, below the 7-digit minimum
		'+4912345678901234567',
	];

	const htmlPatternRegex = new RegExp(`^(?:${PHONE_HTML_PATTERN})$`, 'u');

	describe.each(ACCEPT)('accepts %j', (value) => {
		it('via isValidPhoneNumber()', () => {
			expect(isValidPhoneNumber(value)).toBe(true);
		});

		it('via the HTML pattern', () => {
			expect(htmlPatternRegex.test(value)).toBe(true);
		});
	});

	describe.each(REJECT)('rejects %j', (value) => {
		it('via isValidPhoneNumber()', () => {
			expect(isValidPhoneNumber(value)).toBe(false);
		});

		it('via the HTML pattern', () => {
			expect(htmlPatternRegex.test(value)).toBe(false);
		});
	});

	describe('validateQuestions', () => {
		it('passes a phone number with separators', () => {
			const form = buildForm(phoneQuestion('+49 170 123 45 67'));
			expect(validateQuestions(form)).toBeNull();
		});

		it('blocks a phone number without a country code', () => {
			const form = buildForm(phoneQuestion('49 170 1234567'));
			expect(validateQuestions(form)).toMatch(/Mobile/);
		});
	});
});
