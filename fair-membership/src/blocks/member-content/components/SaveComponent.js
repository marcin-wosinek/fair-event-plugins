import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'member-content-container',
	});
	const innerBlocksProps = useInnerBlocksProps.save(blockProps);

	return <div {...innerBlocksProps}></div>;
}
