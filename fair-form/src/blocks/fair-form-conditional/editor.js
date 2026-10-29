import './style.css';
import './editor.css';

import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	TextControl,
	CheckboxControl,
	Notice,
	Button,
	Spinner,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	FAIR_FORM_QUESTION_BLOCK_NAMES,
	canonicalFairFormBlockName,
} from 'fair-events-shared/src/question-utils.js';
import {
	isCategorySource,
	useCategories,
	resolveCategoryChoices,
} from '../shared/category-options.js';
import { registerFormBlockType } from '../shared/register-form-block.js';

const ALLOWED_BLOCKS = [
	'core/heading',
	'core/paragraph',
	'core/list',
	...FAIR_FORM_QUESTION_BLOCK_NAMES,
];

const OPERATOR_OPTIONS = [
	{ label: __( 'equals', 'fair-form' ), value: 'equals' },
	{ label: __( 'not equals', 'fair-form' ), value: 'not_equals' },
	{ label: __( 'contains', 'fair-form' ), value: 'contains' },
	{ label: __( 'is not empty', 'fair-form' ), value: 'not_empty' },
];

// Event options and ticket types are boolean per checkbox/radio, so they
// share a dedicated selected/not-selected operator pair rather than reusing
// equals/contains.
const SELECTED_OPERATOR_OPTIONS = [
	{ label: __( 'is selected', 'fair-form' ), value: 'selected' },
	{ label: __( 'is not selected', 'fair-form' ), value: 'not_selected' },
];

const SOURCE_OPTIONS = [
	{ label: __( 'Question', 'fair-form' ), value: 'question' },
	{ label: __( 'Event option', 'fair-form' ), value: 'eventOption' },
];

const TICKET_TYPE_SOURCE_OPTION = {
	label: __( 'Ticket type', 'fair-form' ),
	value: 'ticketType',
};

const OPTION_BLOCK_PARENTS = [
	'fair-form/fair-form-multiselect',
	'fair-form/fair-form-select-one',
	'fair-form/fair-form-radio',
];

function findQuestionBlocks( blocks ) {
	const questions = [];
	for ( const block of blocks ) {
		// Blocks still under their legacy names count as their canonical
		// counterparts.
		const blockName = canonicalFairFormBlockName( block.name );
		if (
			block.attributes?.questionKey &&
			blockName !== 'fair-form/fair-form-conditional'
		) {
			const question = {
				key: block.attributes.questionKey,
				text:
					block.attributes.questionText ||
					block.attributes.questionKey,
				blockName,
			};
			if (
				OPTION_BLOCK_PARENTS.includes( blockName ) &&
				isCategorySource( block.attributes )
			) {
				// Resolved from the categories once they are loaded.
				question.categorySource = {
					optionSource: block.attributes.optionSource,
					parentCategoryId: block.attributes.parentCategoryId || 0,
				};
			} else if ( OPTION_BLOCK_PARENTS.includes( blockName ) ) {
				question.options = ( block.innerBlocks || [] )
					.filter(
						( b ) =>
							canonicalFairFormBlockName( b.name ) ===
							'fair-form/fair-form-option'
					)
					.map( ( b ) => b.attributes?.value )
					.filter( Boolean );
			}
			questions.push( question );
		}
		if ( block.innerBlocks?.length ) {
			questions.push( ...findQuestionBlocks( block.innerBlocks ) );
		}
	}
	return questions;
}

registerFormBlockType( 'fair-form-conditional', {
	edit: ( { attributes, setAttributes, clientId } ) => {
		const {
			conditionSource,
			conditionQuestionKey,
			conditionOperator,
			conditionValue,
			conditionOptionShortName,
			conditionTicketTypeIds = [],
		} = attributes;

		const { questionOptions, isEventSignup, eventDateId } = useSelect(
			( select ) => {
				const { getBlockParents, getBlocks, getBlock } =
					select( 'core/block-editor' );
				const parents = getBlockParents( clientId );
				// Find the nearest form-like parent: a Fair Form or an Event
				// Signup (which accepts nested fair-form questions since #615).
				// Both the legacy (fair-audience) and unified (fair-events)
				// Event Signup blocks qualify.
				const formParentId = parents.find( ( parentId ) => {
					const parentBlock = getBlock( parentId );
					return (
						canonicalFairFormBlockName( parentBlock?.name ) ===
							'fair-form/fair-form' ||
						parentBlock?.name === 'fair-audience/event-signup' ||
						parentBlock?.name === 'fair-events/event-signup'
					);
				} );
				if ( ! formParentId ) {
					return {
						questionOptions: [],
						isEventSignup: false,
						eventDateId: 0,
					};
				}
				const formBlock = getBlock( formParentId );
				const formBlocks = getBlocks( formParentId );
				return {
					questionOptions: findQuestionBlocks( formBlocks ),
					isEventSignup:
						formBlock?.name === 'fair-audience/event-signup' ||
						formBlock?.name === 'fair-events/event-signup',
					// The unified block's own eventDateId attribute is only
					// set in edge cases (e.g. the legacy get-tickets
					// transform) — in normal usage editing a fair_event post
					// it stays 0, since the block resolves its event date
					// from post context at render time. The editor's actual
					// source of truth for "which event date is this post" is
					// the same localized global the block's own "Edit
					// tickets" link uses (BlockHooks::localize_event_signup_editor_context).
					eventDateId:
						formBlock?.name === 'fair-events/event-signup'
							? formBlock.attributes?.eventDateId ||
								window.fairEventsSignupBlock?.postEventDateId ||
								0
							: 0,
				};
			},
			[ clientId ]
		);

		// The ticket-type source additionally needs a resolved event date to
		// fetch its ticket types from.
		const canUseTicketType = isEventSignup && eventDateId > 0;

		// The event-option source is only meaningful inside an Event Signup,
		// whose runtime option checkboxes carry the short name. Outside one,
		// keep the source on "question" regardless of the stored attribute.
		const source = isEventSignup ? conditionSource : 'question';
		const isEventOption = source === 'eventOption';
		const isTicketType = source === 'ticketType' && canUseTicketType;

		const sourceOptions = canUseTicketType
			? [ ...SOURCE_OPTIONS, TICKET_TYPE_SOURCE_OPTION ]
			: SOURCE_OPTIONS;

		// Keep request outcomes distinct so only an authoritative success for
		// the active event date can validate and clean the stored selection.
		const [ ticketTypeResult, setTicketTypeResult ] = useState( {
			status: 'loading',
			eventDateId: 0,
			ticketTypes: [],
		} );

		useEffect( () => {
			if ( ! canUseTicketType ) {
				setTicketTypeResult( {
					status: 'loading',
					eventDateId: 0,
					ticketTypes: [],
				} );
				return;
			}
			let cancelled = false;
			setTicketTypeResult( {
				status: 'loading',
				eventDateId,
				ticketTypes: [],
			} );
			apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			} )
				.then( ( response ) => {
					if ( ! cancelled ) {
						setTicketTypeResult( {
							status: 'success',
							eventDateId,
							ticketTypes: response.ticket_types || [],
						} );
					}
				} )
				.catch( () => {
					if ( ! cancelled ) {
						setTicketTypeResult( {
							status: 'failed',
							eventDateId,
							ticketTypes: [],
						} );
					}
				} );
			return () => {
				cancelled = true;
			};
		}, [ canUseTicketType, eventDateId ] );

		const hasCurrentTicketTypes =
			ticketTypeResult.status === 'success' &&
			ticketTypeResult.eventDateId === eventDateId;
		const ticketTypes = hasCurrentTicketTypes
			? ticketTypeResult.ticketTypes
			: [];
		const validatedTicketTypeIds = hasCurrentTicketTypes
			? conditionTicketTypeIds.filter( ( id ) =>
					ticketTypes.some( ( ticketType ) => ticketType.id === id )
				)
			: conditionTicketTypeIds;

		useEffect( () => {
			if ( conditionSource !== 'ticketType' || ! hasCurrentTicketTypes ) {
				return;
			}
			const selectionChanged =
				validatedTicketTypeIds.length !==
					conditionTicketTypeIds.length ||
				validatedTicketTypeIds.some(
					( id, index ) => id !== conditionTicketTypeIds[ index ]
				);
			if ( selectionChanged ) {
				setAttributes( {
					conditionTicketTypeIds: validatedTicketTypeIds,
				} );
			}
		}, [
			conditionSource,
			conditionTicketTypeIds,
			hasCurrentTicketTypes,
			setAttributes,
			validatedTicketTypeIds,
		] );

		const questionSelectOptions = [
			{
				label: __( '— Select a question —', 'fair-form' ),
				value: '',
			},
			...questionOptions.map( ( q ) => ( {
				label: q.text || q.key,
				value: q.key,
			} ) ),
		];

		const selectedQuestion = questionOptions.find(
			( q ) => q.key === conditionQuestionKey
		);

		// Category-backed questions (#1999) get their choices from the
		// current categories, the same scope the public form renders.
		const categorySource =
			! isEventOption && ! isTicketType
				? selectedQuestion?.categorySource
				: undefined;
		const categoriesState = useCategories( !! categorySource );
		let valueChoices = selectedQuestion?.options || [];
		if ( categorySource ) {
			valueChoices =
				categoriesState.status === 'success'
					? resolveCategoryChoices(
							categoriesState.categories,
							categorySource
						).choices
					: [];
		}
		const hasOptions = valueChoices.length > 0;
		// A saved value that is no longer a choice (a renamed or removed
		// category or option) stays selected and flagged, never dropped.
		const isUnavailableValue =
			hasOptions &&
			conditionValue !== '' &&
			! valueChoices.includes( conditionValue );

		// Keep the operator valid for the active source: the question
		// operators (equals/…) and the selected/not_selected operators
		// (event option, ticket type) are disjoint sets.
		const selectedOperator =
			conditionOperator === 'not_selected' ? 'not_selected' : 'selected';

		const isConfigured = isEventOption
			? !! conditionOptionShortName
			: isTicketType
				? validatedTicketTypeIds.length > 0
				: !! conditionQuestionKey;

		let conditionLabel;
		if ( ! isConfigured ) {
			conditionLabel = __( 'No condition set', 'fair-form' );
		} else if ( isEventOption ) {
			conditionLabel = `${ conditionOptionShortName } ${
				selectedOperator === 'not_selected'
					? __( 'is not selected', 'fair-form' )
					: __( 'is selected', 'fair-form' )
			}`;
		} else if ( isTicketType ) {
			const names = validatedTicketTypeIds
				.map(
					( id ) => ticketTypes?.find( ( tt ) => tt.id === id )?.name
				)
				.filter( Boolean );
			conditionLabel = `${
				names.length > 0
					? names.join( ', ' )
					: validatedTicketTypeIds.join( ', ' )
			} ${
				selectedOperator === 'not_selected'
					? __( 'is not selected', 'fair-form' )
					: __( 'is selected', 'fair-form' )
			}`;
		} else {
			conditionLabel = `${ conditionQuestionKey } ${ conditionOperator }${
				conditionOperator !== 'not_empty'
					? ` "${ conditionValue }"`
					: ''
			}`;
		}

		const blockProps = useBlockProps( {
			className: `fair-form-conditional-editor${
				! isConfigured
					? ' fair-form-conditional-editor--unconfigured'
					: ''
			}`,
		} );

		const innerBlocksProps = useInnerBlocksProps(
			{ className: 'fair-form-conditional-inner-blocks' },
			{
				allowedBlocks: ALLOWED_BLOCKS,
				renderAppender: InnerBlocks.ButtonBlockAppender,
			}
		);

		return (
			<>
				<InspectorControls>
					<PanelBody
						title={ __( 'Condition Settings', 'fair-form' ) }
					>
						{ isEventSignup && (
							<SelectControl
								label={ __( 'Condition source', 'fair-form' ) }
								value={ source }
								options={ sourceOptions }
								onChange={ ( value ) =>
									setAttributes( {
										conditionSource: value,
										// Reset the operator to one valid for the
										// newly selected source.
										conditionOperator:
											value === 'eventOption' ||
											value === 'ticketType'
												? 'selected'
												: 'equals',
									} )
								}
							/>
						) }
						{ isEventOption ? (
							<>
								<TextControl
									label={ __(
										'Option short name',
										'fair-form'
									) }
									value={ conditionOptionShortName }
									onChange={ ( value ) =>
										setAttributes( {
											conditionOptionShortName: value,
										} )
									}
									help={ __(
										"Enter the option's short name (set it in the event's Tickets tab). Options can't be listed here because they come from the selected event date at render time.",
										'fair-form'
									) }
								/>
								<SelectControl
									label={ __( 'Operator', 'fair-form' ) }
									value={ selectedOperator }
									options={ SELECTED_OPERATOR_OPTIONS }
									onChange={ ( value ) =>
										setAttributes( {
											conditionOperator: value,
										} )
									}
								/>
							</>
						) : isTicketType ? (
							<>
								{ ( ticketTypes || [] ).map( ( ticketType ) => (
									<CheckboxControl
										key={ ticketType.id }
										label={ ticketType.name }
										checked={ conditionTicketTypeIds.includes(
											ticketType.id
										) }
										onChange={ ( checked ) => {
											const next = checked
												? [
														...conditionTicketTypeIds,
														ticketType.id,
													]
												: conditionTicketTypeIds.filter(
														( id ) =>
															id !== ticketType.id
													);
											setAttributes( {
												conditionTicketTypeIds: next,
											} );
										} }
									/>
								) ) }
								<SelectControl
									label={ __( 'Operator', 'fair-form' ) }
									value={ selectedOperator }
									options={ SELECTED_OPERATOR_OPTIONS }
									onChange={ ( value ) =>
										setAttributes( {
											conditionOperator: value,
										} )
									}
								/>
							</>
						) : (
							<>
								<SelectControl
									label={ __(
										'Show when question',
										'fair-form'
									) }
									value={ conditionQuestionKey }
									options={ questionSelectOptions }
									onChange={ ( value ) => {
										const question = questionOptions.find(
											( q ) => q.key === value
										);
										const updates = {
											conditionQuestionKey: value,
											conditionValue: '',
										};
										if (
											question?.blockName ===
											'fair-form/fair-form-multiselect'
										) {
											updates.conditionOperator =
												'contains';
										}
										setAttributes( updates );
									} }
								/>
								<SelectControl
									label={ __( 'Operator', 'fair-form' ) }
									value={ conditionOperator }
									options={ OPERATOR_OPTIONS }
									onChange={ ( value ) =>
										setAttributes( {
											conditionOperator: value,
										} )
									}
								/>
								{ conditionOperator !== 'not_empty' &&
									( hasOptions ? (
										<SelectControl
											label={ __( 'Value', 'fair-form' ) }
											value={ conditionValue }
											options={ [
												{
													label: __(
														'— Select a value —',
														'fair-form'
													),
													value: '',
												},
												...( isUnavailableValue
													? [
															{
																label: sprintf(
																	/* translators: %s: saved condition value */
																	__(
																		'%s (no longer a choice)',
																		'fair-form'
																	),
																	conditionValue
																),
																value: conditionValue,
															},
														]
													: [] ),
												...valueChoices.map(
													( opt ) => ( {
														label: opt,
														value: opt,
													} )
												),
											] }
											onChange={ ( value ) =>
												setAttributes( {
													conditionValue: value,
												} )
											}
										/>
									) : (
										<TextControl
											label={ __( 'Value', 'fair-form' ) }
											value={ conditionValue }
											onChange={ ( value ) =>
												setAttributes( {
													conditionValue: value,
												} )
											}
											help={ __(
												'The value to compare against.',
												'fair-form'
											) }
										/>
									) ) }
								{ conditionOperator !== 'not_empty' &&
									isUnavailableValue && (
										<Notice
											status="warning"
											isDismissible={ false }
										>
											{ sprintf(
												/* translators: %s: saved condition value */
												__(
													'“%s” is no longer one of this question’s choices. Pick a current choice or update the condition.',
													'fair-form'
												),
												conditionValue
											) }
										</Notice>
									) }
								{ categorySource &&
									categoriesState.status === 'loading' && (
										<p>
											<Spinner />{ ' ' }
											{ __(
												'Loading categories…',
												'fair-form'
											) }
										</p>
									) }
								{ categorySource &&
									categoriesState.status === 'error' && (
										<Notice
											status="error"
											isDismissible={ false }
										>
											{ __(
												'The categories could not be loaded. Check your connection and try again.',
												'fair-form'
											) }{ ' ' }
											<Button
												variant="link"
												onClick={
													categoriesState.retry
												}
											>
												{ __(
													'Try again',
													'fair-form'
												) }
											</Button>
										</Notice>
									) }
							</>
						) }
					</PanelBody>
				</InspectorControls>

				<div { ...blockProps }>
					<span className="fair-form-conditional-editor-label">
						<span className="dashicons dashicons-visibility" />
						{ conditionLabel }
					</span>
					<div { ...innerBlocksProps } />
				</div>
			</>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
} );
