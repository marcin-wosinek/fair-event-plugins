/**
 * Events Calendar Block - Edit Component
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	InspectorControls,
	PanelColorSettings,
} from '@wordpress/block-editor';
import {
	PanelBody,
	ToggleControl,
	SelectControl,
	Notice,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import ServerSideRender from '@wordpress/server-side-render';
import { EventSourceSelector } from 'fair-events-shared';
import CategorySelector from '../../components/CategorySelector.js';

const EditComponent = ( { attributes, setAttributes } ) => {
	const {
		showNavigation,
		categories,
		displayPattern,
		showDrafts,
		backgroundColor,
		textColor,
		headerBackgroundColor,
		eventSources,
		showSubscribe,
	} = attributes;

	const blockProps = useBlockProps();

	const calendarPatterns = useSelect( ( select ) => {
		const patterns = select( 'core' ).getBlockPatterns?.() || [];
		return patterns.filter(
			( pattern ) =>
				pattern.categories?.includes( 'fair-events' ) &&
				pattern.name?.includes( 'calendar-event' )
		);
	}, [] );

	const patternOptions = calendarPatterns.map( ( pattern ) => ( {
		label: pattern.title,
		value: pattern.name,
	} ) );

	const hasOldFormat =
		eventSources.length > 0 &&
		typeof eventSources[ 0 ] === 'object' &&
		'icalFeed' in eventSources[ 0 ];

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Calendar Settings', 'fair-events' ) }
					initialOpen={ true }
				>
					<SelectControl
						label={ __( 'Event Display Pattern', 'fair-events' ) }
						value={ displayPattern }
						options={ patternOptions }
						onChange={ ( value ) =>
							setAttributes( { displayPattern: value } )
						}
						help={ __(
							'Choose how events are displayed in calendar cells',
							'fair-events'
						) }
					/>

					<ToggleControl
						label={ __( 'Show Navigation', 'fair-events' ) }
						checked={ showNavigation }
						onChange={ ( value ) =>
							setAttributes( { showNavigation: value } )
						}
						help={ __(
							'Display previous/next month navigation',
							'fair-events'
						) }
					/>

					<ToggleControl
						label={ __( 'Show Draft Events', 'fair-events' ) }
						checked={ showDrafts }
						onChange={ ( value ) =>
							setAttributes( { showDrafts: value } )
						}
						help={ __(
							'Display draft events in the calendar',
							'fair-events'
						) }
					/>

					<ToggleControl
						label={ __( 'Show Subscribe Link', 'fair-events' ) }
						checked={ showSubscribe }
						onChange={ ( value ) =>
							setAttributes( { showSubscribe: value } )
						}
						help={ __(
							'Displays a link to subscribe to this calendar in an external calendar app',
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

				<PanelColorSettings
					title={ __( 'Colors', 'fair-events' ) }
					colorSettings={ [
						{
							value: backgroundColor,
							onChange: ( color ) =>
								setAttributes( {
									backgroundColor: color || 'primary',
								} ),
							label: __( 'Event Background', 'fair-events' ),
						},
						{
							value: textColor,
							onChange: ( color ) =>
								setAttributes( {
									textColor: color || '#ffffff',
								} ),
							label: __( 'Event Text', 'fair-events' ),
						},
						{
							value: headerBackgroundColor,
							onChange: ( color ) =>
								setAttributes( {
									headerBackgroundColor: color || '#f9f9f9',
								} ),
							label: __( 'Header Background', 'fair-events' ),
						},
					] }
				>
					{ showDrafts && (
						<p
							style={ {
								fontSize: '12px',
								color: '#757575',
								marginTop: '12px',
							} }
						>
							{ __(
								'Draft events will appear as outlined buttons using these colors.',
								'fair-events'
							) }
						</p>
					) }
				</PanelColorSettings>

				<PanelBody
					title={ __( 'Event Sources', 'fair-events' ) }
					initialOpen={ false }
				>
					<p style={ { marginBottom: '16px', color: '#666' } }>
						{ __(
							'Select event sources to display in the calendar.',
							'fair-events'
						) }
					</p>

					{ hasOldFormat && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Event sources format has changed. Please re-select your event sources.',
								'fair-events'
							) }
						</Notice>
					) }

					<EventSourceSelector
						selectedSources={ eventSources }
						onChange={ ( slugs ) =>
							setAttributes( { eventSources: slugs } )
						}
						label=""
					/>
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<ServerSideRender
					block="fair-events/events-calendar"
					attributes={ attributes }
				/>
			</div>
		</>
	);
};

export default EditComponent;
