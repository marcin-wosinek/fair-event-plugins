/**
 * Search-and-pick list of participant profiles, shared by the "Add
 * participants" dialogs of the Event Participants page and the Manage Event
 * Audience tab.
 *
 * The selector renders the search row, the selection summary, the scrollable
 * checkbox list and its no-results message. The dialog, candidate loading,
 * role choice and submission stay with the caller, which keeps the search and
 * the selection in `useParticipantSelection()` so each dialog has its own.
 */

import { useId, useState } from '@wordpress/element';
import { Button, CheckboxControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

/**
 * Whether a profile's name, surname or email contains the search text,
 * ignoring case.
 *
 * @param {Object} participant Profile with name, surname and email.
 * @param {string} search      Text to look for.
 * @return {boolean} True when one of the fields matches.
 */
export const matchesParticipantSearch = ( participant, search ) => {
	const term = search.toLowerCase();
	return [ participant.name, participant.surname, participant.email ].some(
		( value ) => ( value || '' ).toLowerCase().includes( term )
	);
};

/**
 * The profiles a search shows.
 *
 * @param {Array}   participants          Candidate profiles.
 * @param {string}  search                Search text.
 * @param {Object}  [options]             Matching options.
 * @param {boolean} [options.ignoreBlank] Treat a whitespace-only search as no search.
 * @return {Array} Matching profiles, in their original order.
 */
export const filterParticipantsBySearch = (
	participants,
	search,
	{ ignoreBlank = false } = {}
) => {
	const active = ignoreBlank ? search.trim() !== '' : search !== '';
	return active
		? participants.filter( ( p ) => matchesParticipantSearch( p, search ) )
		: participants;
};

/**
 * Search and selection state for one selector instance.
 *
 * @return {Object} `search` and `selectedIds` with their setters, and `reset()` to clear both.
 */
export const useParticipantSelection = () => {
	const [ search, setSearch ] = useState( '' );
	const [ selectedIds, setSelectedIds ] = useState( () => new Set() );
	const reset = () => {
		setSearch( '' );
		setSelectedIds( new Set() );
	};
	return { search, setSearch, selectedIds, setSelectedIds, reset };
};

/**
 * The search row, selection summary and checkbox list.
 *
 * @param {Object}  props                             Component props.
 * @param {Array}   props.participants                Candidates to search, after any caller filter (such as a group).
 * @param {Object}  props.selection                   State from `useParticipantSelection()`.
 * @param {number}  [props.selectedCount]             Count to report as selected; defaults to the size of the selection.
 * @param {boolean} [props.ignoreBlankSearch]         Treat a whitespace-only search as no search.
 * @param {boolean} [props.showSelectAll]             Offer Select All / Deselect All for the shown profiles.
 * @param {Element} [props.controls]                  Controls shown beside the search field.
 * @param {boolean} [props.checkboxHasNoMarginBottom] Passed to each row's CheckboxControl.
 * @return {Element} The selector.
 */
export default function ParticipantSelector( {
	participants,
	selection,
	selectedCount,
	ignoreBlankSearch = false,
	showSelectAll = false,
	controls = null,
	checkboxHasNoMarginBottom = false,
} ) {
	const instanceId = useId();
	const { search, setSearch, selectedIds, setSelectedIds } = selection;

	const shown = filterParticipantsBySearch( participants, search, {
		ignoreBlank: ignoreBlankSearch,
	} );
	const count = selectedCount ?? selectedIds.size;
	const allShownSelected =
		shown.length > 0 && shown.every( ( p ) => selectedIds.has( p.id ) );

	const toggle = ( id ) => {
		const next = new Set( selectedIds );
		if ( next.has( id ) ) {
			next.delete( id );
		} else {
			next.add( id );
		}
		setSelectedIds( next );
	};

	const toggleAllShown = () => {
		const next = new Set( selectedIds );
		shown.forEach( ( p ) =>
			allShownSelected ? next.delete( p.id ) : next.add( p.id )
		);
		setSelectedIds( next );
	};

	const summary =
		count > 0
			? sprintf(
					/* translators: 1: selected count, 2: shown count */
					__( '%1$d selected, %2$d shown', 'fair-audience' ),
					count,
					shown.length
				)
			: sprintf(
					/* translators: %d: number of available participants */
					__( '%d participant(s) available', 'fair-audience' ),
					shown.length
				);

	const summaryStyle = { fontSize: '12px', color: '#666' };

	return (
		<>
			<div
				style={ {
					display: 'flex',
					gap: '10px',
					marginBottom: '10px',
				} }
			>
				<input
					type="text"
					placeholder={ __(
						'Search by name or email…',
						'fair-audience'
					) }
					aria-label={ __( 'Search participants', 'fair-audience' ) }
					value={ search }
					onChange={ ( e ) => setSearch( e.target.value ) }
					style={ {
						flex: 1,
						padding: '8px 12px',
						border: '1px solid #ddd',
						borderRadius: '4px',
					} }
				/>
				{ controls }
			</div>

			{ showSelectAll ? (
				<div
					style={ {
						marginBottom: '10px',
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
					} }
				>
					<span style={ summaryStyle }>{ summary }</span>
					<Button
						variant="secondary"
						size="small"
						onClick={ toggleAllShown }
					>
						{ allShownSelected
							? __( 'Deselect All', 'fair-audience' )
							: __( 'Select All', 'fair-audience' ) }
					</Button>
				</div>
			) : (
				<div style={ { marginBottom: '10px', ...summaryStyle } }>
					{ summary }
				</div>
			) }

			<div
				style={ {
					maxHeight: '400px',
					overflowY: 'auto',
					border: '1px solid #ddd',
					borderRadius: '4px',
				} }
			>
				{ shown.map( ( p ) => {
					const detailsId = `fair-audience-participant-selector-${ instanceId }-${ p.id }`;
					return (
						<div
							key={ p.id }
							style={ {
								padding: '10px 15px',
								borderBottom: '1px solid #eee',
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
							} }
						>
							<CheckboxControl
								checked={ selectedIds.has( p.id ) }
								onChange={ () => toggle( p.id ) }
								aria-labelledby={ detailsId }
								__nextHasNoMarginBottom={
									checkboxHasNoMarginBottom || undefined
								}
							/>
							<div id={ detailsId }>
								<strong>
									{ p.name } { p.surname }
								</strong>
								<br />
								<span
									style={ {
										color: '#666',
										fontSize: '12px',
									} }
								>
									{ p.email }
								</span>
							</div>
						</div>
					);
				} ) }
				{ shown.length === 0 && (
					<p style={ { padding: '15px', color: '#666' } }>
						{ __(
							'No participants match your search.',
							'fair-audience'
						) }
					</p>
				) }
			</div>
		</>
	);
}
