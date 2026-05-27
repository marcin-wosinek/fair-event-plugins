/**
 * @jest-environment jsdom
 */
import { evaluateConditionals } from '../questionnaire.js';

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
