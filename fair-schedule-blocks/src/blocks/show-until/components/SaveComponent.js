import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'show-until-content',
	});
	const innerBlocksProps = useInnerBlocksProps.save(blockProps);

	return <div {...innerBlocksProps}></div>;
}
