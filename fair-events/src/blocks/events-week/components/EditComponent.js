/**
 * Events Week View Block - Edit Component
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	InspectorControls,
	PanelColorSettings,
} from '@wordpress/block-editor';
import { PanelBody, ToggleControl, Notice } from '@wordpress/components';
import ServerSideRender from '@wordpress/server-side-render';
import { EventSourceSelector } from 'fair-events-shared';
import CategorySelector from '../../components/CategorySelector.js';

const EditComponent = ( { attributes, setAttributes } ) => {
	const {
		showNavigation,
		categories,
		showDrafts,
		backgroundColor,
		textColor,
		headerBackgroundColor,
		eventSources,
		showCopySummary,
	} = attributes;

	const blockProps = useBlockProps();

	const hasOldFormat =
		eventSources.length > 0 &&
		typeof eventSources[ 0 ] === 'object' &&
		'icalFeed' in eventSources[ 0 ];

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Week View Settings', 'fair-events' ) }
					initialOpen={ true }
				>
					<ToggleControl
						label={ __( 'Show Navigation', 'fair-events' ) }
						checked={ showNavigation }
						onChange={ ( value ) =>
							setAttributes( { showNavigation: value } )
						}
						help={ __(
							'Display previous/next week navigation',
							'fair-events'
						) }
					/>

					<ToggleControl
						label={ __( 'Show Draft Events', 'fair-events' ) }
						checked={ showDrafts }
						onChange={ ( value ) =>
							setAttributes( { showDrafts: value } )
						}
					/>

					<ToggleControl
						label={ __(
							'Show Copy Summary Button',
							'fair-events'
						) }
						checked={ showCopySummary }
						onChange={ ( value ) =>
							setAttributes( { showCopySummary: value } )
						}
						help={ __(
							'Displays a button to copy week summary as text',
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
				/>

				<PanelBody
					title={ __( 'Event Sources', 'fair-events' ) }
					initialOpen={ false }
				>
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
					block="fair-events/events-week"
					attributes={ attributes }
				/>
			</div>
		</>
	);
};

export default EditComponent;
