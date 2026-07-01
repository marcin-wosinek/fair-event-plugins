/**
 * Mail Body Editor
 *
 * Controlled textarea for composing a scheduled-message body, with the same
 * placeholder-insertion affordances as fair-audience's custom-mail page (photo
 * upload link, manage-subscription link, tokenized page link) plus the
 * per-recipient/per-message tokens scheduled mailings support.
 *
 * @package FairAudience
 */

import { useRef, useState } from '@wordpress/element';
import { Button, TextControl, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Placeholder chips inserted as literal tokens (resolved per recipient/message
 * at send time).
 */
const TOKEN_CHIPS = [
	{ token: '{participant_name}', label: __('Name', 'fair-audience') },
	{ token: '{event_name}', label: __('Event name', 'fair-audience') },
	{ token: '{event_date}', label: __('Event date', 'fair-audience') },
	{ token: '{unsubscribe_link}', label: __('Unsubscribe', 'fair-audience') },
];

/**
 * Body editor with placeholder insertion.
 *
 * @param {Object}   props          Component props.
 * @param {string}   props.value    Current body HTML.
 * @param {Function} props.onChange Called with the next body HTML.
 * @param {boolean}  props.disabled Whether inputs are disabled.
 * @return {JSX.Element} The editor.
 */
export default function MailBodyEditor({ value, onChange, disabled }) {
	const textareaRef = useRef(null);
	const [pageSearch, setPageSearch] = useState('');
	const [pageResults, setPageResults] = useState([]);
	const [selectedPage, setSelectedPage] = useState(null);
	const [isSearching, setIsSearching] = useState(false);

	/**
	 * Insert a snippet at the caret (or replace the selection) of the textarea.
	 *
	 * @param {string} snippet Text/HTML to insert.
	 */
	const insertAtCursor = (snippet) => {
		const el = textareaRef.current;
		if (!el) {
			onChange(`${value}${snippet}`);
			return;
		}
		const start = el.selectionStart ?? value.length;
		const end = el.selectionEnd ?? value.length;
		const next = value.slice(0, start) + snippet + value.slice(end);
		onChange(next);
		// Restore caret after the inserted snippet on the next tick.
		requestAnimationFrame(() => {
			el.focus();
			const caret = start + snippet.length;
			el.setSelectionRange(caret, caret);
		});
	};

	/**
	 * Insert a placeholder link, wrapping the current selection as link text.
	 *
	 * @param {string} placeholder Href placeholder, e.g. '{photo_upload_url}'.
	 * @param {string} defaultText Link text when nothing is selected.
	 */
	const insertPlaceholderLink = (placeholder, defaultText) => {
		const el = textareaRef.current;
		let linkText = defaultText;
		if (el) {
			const selected = value.slice(el.selectionStart, el.selectionEnd);
			if (selected) {
				linkText = selected;
			}
		}
		insertAtCursor(`<a href="${placeholder}">${linkText}</a>`);
	};

	/**
	 * Search published pages for the token-link picker.
	 *
	 * @param {string} term Search term.
	 */
	const searchPages = (term) => {
		setPageSearch(term);
		setSelectedPage(null);
		if (!term || term.length < 2) {
			setPageResults([]);
			return;
		}
		setIsSearching(true);
		apiFetch({
			path: `/wp/v2/pages?search=${encodeURIComponent(
				term
			)}&per_page=5&_fields=id,title`,
		})
			.then((results) => setPageResults(results || []))
			.catch(() => setPageResults([]))
			.finally(() => setIsSearching(false));
	};

	return (
		<div style={{ marginBottom: '16px' }}>
			<label
				htmlFor="fair-events-mail-body"
				style={{
					display: 'block',
					marginBottom: '8px',
					fontWeight: '600',
				}}
			>
				{__('Body', 'fair-audience')}
			</label>
			<textarea
				id="fair-events-mail-body"
				ref={textareaRef}
				rows={10}
				style={{ width: '100%' }}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				disabled={disabled}
			/>

			<div
				style={{
					marginTop: '8px',
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'center',
					gap: '8px',
				}}
			>
				<Button
					variant="secondary"
					isSmall
					onClick={() =>
						insertPlaceholderLink(
							'{photo_upload_url}',
							__('Upload photos', 'fair-audience')
						)
					}
					disabled={disabled}
				>
					{__('Insert photo upload link', 'fair-audience')}
				</Button>
				<Button
					variant="secondary"
					isSmall
					onClick={() =>
						insertPlaceholderLink(
							'{event_page_url}',
							__('Open event page', 'fair-audience')
						)
					}
					disabled={disabled}
				>
					{__('Insert event page link', 'fair-audience')}
				</Button>

				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: '4px',
						position: 'relative',
					}}
				>
					<TextControl
						placeholder={__('Search page…', 'fair-audience')}
						value={
							selectedPage
								? selectedPage.title.rendered
								: pageSearch
						}
						onChange={searchPages}
						disabled={disabled}
						__nextHasNoMarginBottom
						style={{ width: '180px', marginBottom: 0 }}
					/>
					{isSearching && <Spinner />}
					{pageResults.length > 0 && !selectedPage && (
						<ul
							style={{
								position: 'absolute',
								top: '100%',
								left: 0,
								zIndex: 100,
								background: '#fff',
								border: '1px solid #ccc',
								borderRadius: '2px',
								listStyle: 'none',
								margin: 0,
								padding: 0,
								maxHeight: '200px',
								overflow: 'auto',
								width: '280px',
								boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
							}}
						>
							{pageResults.map((page) => (
								<li
									key={page.id}
									style={{
										padding: '6px 10px',
										cursor: 'pointer',
									}}
									onMouseDown={() => {
										setSelectedPage(page);
										setPageSearch('');
										setPageResults([]);
									}}
								>
									{page.title.rendered}
								</li>
							))}
						</ul>
					)}
					<Button
						variant="secondary"
						isSmall
						onClick={() => {
							if (selectedPage) {
								insertPlaceholderLink(
									`{token_link_${selectedPage.id}}`,
									selectedPage.title.rendered
								);
							}
						}}
						disabled={disabled || !selectedPage}
					>
						{__('Insert token link', 'fair-audience')}
					</Button>
				</span>
			</div>

			<div
				style={{
					marginTop: '8px',
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'center',
					gap: '6px',
				}}
			>
				<span style={{ color: '#666', fontSize: '12px' }}>
					{__('Insert token:', 'fair-audience')}
				</span>
				{TOKEN_CHIPS.map((chip) => (
					<Button
						key={chip.token}
						variant="tertiary"
						isSmall
						onClick={() => insertAtCursor(chip.token)}
						disabled={disabled}
					>
						{chip.label}
					</Button>
				))}
			</div>
		</div>
	);
}
