/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl, Notice } from '@wordpress/components';
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

/**
 * Edit component for Events List block
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { attributes, setAttributes } ) {
	const { timeFilter, categories, displayPattern, eventSources } = attributes;

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
							'Query Loop patterns (e.g. Event List, Event Grid) show WordPress-linked events only. A custom pattern (not built with the Query block) can show every event source — standalone, calendar feed, and external.',
							'fair-events'
						) }
					/>
					{ showQueryLoopSourceNotice && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'The selected pattern uses a Query Loop, so it can only show WordPress-linked events. Events from the selected event sources will not appear — choose a custom pattern to show them.',
								'fair-events'
							) }
						</Notice>
					) }
					<SelectControl
						label={ __( 'Time Filter', 'fair-events' ) }
						value={ timeFilter }
						options={ [
							{
								label: __( 'All Events', 'fair-events' ),
								value: 'all',
							},
							{
								label: __( 'Upcoming Events', 'fair-events' ),
								value: 'upcoming',
							},
							{
								label: __( 'Past Events', 'fair-events' ),
								value: 'past',
							},
							{
								label: __( 'Ongoing Events', 'fair-events' ),
								value: 'ongoing',
							},
						] }
						onChange={ ( value ) =>
							setAttributes( { timeFilter: value } )
						}
						help={ __(
							'Filter events by time relative to now',
							'fair-events'
						) }
					/>
					<CategorySelector
						selectedCategories={ categories }
						onChange={ ( ids ) =>
							setAttributes( { categories: ids } )
						}
					/>
				</PanelBody>

				<PanelBody
					title={ __( 'Event Sources', 'fair-events' ) }
					initialOpen={ false }
				>
					<p style={ { marginBottom: '16px', color: '#666' } }>
						{ __(
							'Select event sources to display in the list.',
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
				<ServerSideRender
					block="fair-events/events-list"
					attributes={ attributes }
				/>
			</div>
		</>
	);
}
