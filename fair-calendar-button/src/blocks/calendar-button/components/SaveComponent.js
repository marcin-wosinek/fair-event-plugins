/**
 * Save component for the Calendar Button Block
 */
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Save component for the Calendar Button Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'calendar-button',
	});

	const { buttonText } = attributes;

	return (
		<div {...blockProps}>
			<button className="calendar-button-btn">
				{buttonText || __('Add to Calendar', 'fair-calendar-button')}
			</button>
		</div>
	);
}
