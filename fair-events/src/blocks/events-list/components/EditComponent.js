/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	CheckboxControl,
	Notice,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { __, sprintf } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import { EventSourceSelector } from 'fair-events-shared';
import CategorySelector from '../../components/CategorySelector.js';
import {
	isEventsListPattern,
	classifyPatternContent,
	PATTERN_TYPE_QUERY_LOOP,
} from '../patternCompatibility.js';
import {
	PERIOD_PAST,
	PERIOD_CURRENT,
	PERIOD_FUTURE,
	normalizeTimeFilters,
	togglePeriod,
} from '../timeFilters.js';

/**
 * Edit component for Events List block
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { attributes, setAttributes } ) {
	const { categories, displayPattern, eventSources } = attributes;
	const timePeriods = normalizeTimeFilters( attributes );
	const periodOptions = [
		{ value: PERIOD_PAST, label: __( 'Past', 'fair-events' ) },
		{ value: PERIOD_CURRENT, label: __( 'Current', 'fair-events' ) },
		{ value: PERIOD_FUTURE, label: __( 'Future', 'fair-events' ) },
	];

	let timeHelp = __(
		'Shows events in any checked period, soonest first.',
		'fair-events'
	);
	if ( timePeriods.length === 1 && timePeriods[ 0 ] === PERIOD_FUTURE ) {
		timeHelp = __(
			'Shows events that have not started yet. A recurring series from this site appears once, at its next date, with its schedule. Events from calendar feeds and external sources are listed one date at a time.',
			'fair-events'
		);
	} else if ( timePeriods.length === 1 && timePeriods[ 0 ] === PERIOD_PAST ) {
		timeHelp = __(
			'Shows events that have ended, most recent first.',
			'fair-events'
		);
	} else if (
		timePeriods.length === 1 &&
		timePeriods[ 0 ] === PERIOD_CURRENT
	) {
		timeHelp = __( 'Shows events happening now.', 'fair-events' );
	}

	const blockProps = useBlockProps();

	const fairEventsPatterns = useSelect( ( select ) => {
		const patterns = select( 'core' ).getBlockPatterns?.() || [];
		return patterns.filter(
			( pattern ) =>
				pattern.categories?.includes( 'fair-events' ) &&
				isEventsListPattern( pattern.name )
		);
	}, [] );

	const userPatterns = useSelect( ( select ) => {
		const patterns = select( 'core' ).getEntityRecords(
			'postType',
			'wp_block',
			{
				per_page: -1,
			}
		);
		return patterns || [];
	}, [] );

	const patternsWithType = [
		...fairEventsPatterns.map( ( pattern ) => ( {
			label: pattern.title,
			value: pattern.name,
			type: classifyPatternContent( pattern.content ),
		} ) ),
		...userPatterns.map( ( pattern ) => ( {
			label:
				( pattern.title?.rendered ||
					pattern.title?.raw ||
					__( 'Untitled Pattern', 'fair-events' ) ) +
				' (User Pattern)',
			value: 'wp_block:' + pattern.id,
			type: classifyPatternContent( pattern.content?.raw ),
		} ) ),
	];

	// A pattern that was saved, then deleted or unpublished, would otherwise
	// silently vanish from the dropdown and appear to reset to whichever
	// option happens to be first. Keep the saved value visible (and clearly
	// marked as unavailable) instead of hiding the mismatch.
	const selectedPattern = patternsWithType.find(
		( pattern ) => pattern.value === displayPattern
	);
	const allPatterns = selectedPattern
		? patternsWithType
		: [
				...patternsWithType,
				{
					label: sprintf(
						/* translators: %s: the unavailable pattern's stored name. */
						__( 'Unavailable pattern (%s)', 'fair-events' ),
						displayPattern
					),
					value: displayPattern,
				},
			];

	const selectedPatternType = selectedPattern?.type;
	const showQueryLoopSourceNotice =
		selectedPatternType === PATTERN_TYPE_QUERY_LOOP &&
		eventSources.length > 0;

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Events List Settings', 'fair-events' ) }
				>
					<SelectControl
						label={ __( 'Display Pattern', 'fair-events' ) }
						value={ displayPattern }
						options={ allPatterns }
						onChange={ ( value ) =>
							setAttributes( { displayPattern: value } )
						}
						help={ __(
							'Query Loop patterns (e.g. Event List, Event Grid) show WordPress-linked events only. A custom pattern (not built with the Query block) can show every kind of event — standalone, calendar feed, and external.',
							'fair-events'
						) }
					/>
					{ showQueryLoopSourceNotice && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'The selected pattern uses a Query Loop, so it can only show WordPress-linked events. Events from the selected event feeds will not appear — choose a custom pattern to show them.',
								'fair-events'
							) }
						</Notice>
					) }
					<fieldset
						className="fair-events-events-list-time-filters"
						aria-describedby="fair-events-events-list-time-help"
						style={ { margin: '0 0 16px', padding: 0, border: 0 } }
					>
						<legend
							className="components-base-control__label"
							style={ {
								padding: 0,
								marginBottom: '8px',
								fontSize: '11px',
								fontWeight: 500,
								textTransform: 'uppercase',
							} }
						>
							{ __( 'Show events', 'fair-events' ) }
						</legend>
						{ periodOptions.map( ( option ) => (
							<CheckboxControl
								key={ option.value }
								__nextHasNoMarginBottom
								label={ option.label }
								checked={ timePeriods.includes( option.value ) }
								onChange={ ( checked ) =>
									setAttributes( {
										timeFilters: togglePeriod(
											timePeriods,
											option.value,
											checked
										),
									} )
								}
							/>
						) ) }
						{ timePeriods.length === 0 ? (
							<div id="fair-events-events-list-time-help">
								<Notice
									status="warning"
									isDismissible={ false }
								>
									{ __(
										'Select at least one period to display events.',
										'fair-events'
									) }
								</Notice>
							</div>
						) : (
							<p
								id="fair-events-events-list-time-help"
								className="components-base-control__help"
								style={ {
									marginTop: '8px',
									fontSize: '12px',
									fontStyle: 'normal',
									color: '#757575',
								} }
							>
								{ timeHelp }
							</p>
						) }
					</fieldset>
					<CategorySelector
						selectedCategories={ categories }
						onChange={ ( ids ) =>
							setAttributes( { categories: ids } )
						}
					/>
				</PanelBody>

				<PanelBody
					title={ __( 'Event Feeds', 'fair-events' ) }
					initialOpen={ false }
				>
					<p style={ { marginBottom: '16px', color: '#666' } }>
						{ __(
							'Select event feeds to display in the list.',
							'fair-events'
						) }
					</p>

					<EventSourceSelector
						selectedSources={ eventSources }
						onChange={ ( slugs ) =>
							setAttributes( { eventSources: slugs } )
						}
					/>
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				{ /* POST keeps an empty `timeFilters` (no periods) intact;
				a GET query string would drop it and fall back to Future. */ }
				<ServerSideRender
					block="fair-events/events-list"
					attributes={ attributes }
					httpMethod="POST"
				/>
			</div>
		</>
	);
}
