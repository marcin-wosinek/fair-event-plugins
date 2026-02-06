/**
 * Image Crop Modal Component
 *
 * Displays a modal with an interactive cropper for customizing the crop area
 * before generating an image export.
 *
 * @package FairEvents
 */

import { useState, useCallback } from '@wordpress/element';
import {
	Modal,
	Button,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import Cropper from 'react-easy-crop';

export default function ImageCropModal({
	imageUrl,
	format,
	onGenerate,
	onClose,
}) {
	const [crop, setCrop] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

	const onCropComplete = useCallback((_croppedArea, pixels) => {
		setCroppedAreaPixels(pixels);
	}, []);

	const handleGenerate = () => {
		if (croppedAreaPixels) {
			onGenerate(croppedAreaPixels);
		}
	};

	const aspect = format.width / format.height;

	return (
		<Modal
			title={`${__('Crop for', 'fair-events')} ${format.label} (${
				format.width
			}\u00D7${format.height})`}
			onRequestClose={onClose}
			isFullScreen
		>
			<div
				style={{
					position: 'relative',
					width: '100%',
					height: 'calc(100vh - 200px)',
				}}
			>
				<Cropper
					image={imageUrl}
					crop={crop}
					zoom={zoom}
					aspect={aspect}
					onCropChange={setCrop}
					onZoomChange={setZoom}
					onCropComplete={onCropComplete}
				/>
			</div>
			<HStack
				spacing={3}
				justify="flex-end"
				style={{ marginTop: '16px' }}
			>
				<Button variant="tertiary" onClick={onClose}>
					{__('Cancel', 'fair-events')}
				</Button>
				<Button
					variant="primary"
					onClick={handleGenerate}
					disabled={!croppedAreaPixels}
				>
					{__('Generate', 'fair-events')}
				</Button>
			</HStack>
		</Modal>
	);
}
