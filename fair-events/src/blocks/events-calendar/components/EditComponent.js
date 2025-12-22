/**
 * Events Calendar Block - Edit Component
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, ToggleControl, RadioControl } from '@wordpress/components';
import { calendar } from '@wordpress/icons';
import { Icon } from '@wordpress/components';

const EditComponent = ({ attributes, setAttributes }) => {
	const { startOfWeek, showNavigation } = attributes;

	const blockProps = useBlockProps({
		className: 'fair-events-calendar-placeholder',
	});

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__('Calendar Settings', 'fair-events')}
					initialOpen={true}
				>
					<RadioControl
						label={__('Start of Week', 'fair-events')}
						selected={startOfWeek}
						options={[
							{
								label: __('Monday', 'fair-events'),
								value: 1,
							},
							{
								label: __('Sunday', 'fair-events'),
								value: 0,
							},
						]}
						onChange={(value) =>
							setAttributes({ startOfWeek: parseInt(value) })
						}
					/>

					<ToggleControl
						label={__('Show Navigation', 'fair-events')}
						checked={showNavigation}
						onChange={(value) =>
							setAttributes({ showNavigation: value })
						}
						help={__(
							'Display previous/next month navigation',
							'fair-events'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div
					style={{
						padding: '40px',
						textAlign: 'center',
						border: '2px dashed #ddd',
						borderRadius: '4px',
						background: '#f9f9f9',
					}}
				>
					<Icon
						icon={calendar}
						style={{ width: '48px', height: '48px', opacity: 0.5 }}
					/>
					<h3 style={{ marginTop: '16px', color: '#666' }}>
						{__('Events Calendar', 'fair-events')}
					</h3>
					<p style={{ color: '#999', marginTop: '8px' }}>
						{__(
							'Calendar will be displayed on the frontend',
							'fair-events'
						)}
					</p>
				</div>
			</div>
		</>
	);
};

export default EditComponent;
