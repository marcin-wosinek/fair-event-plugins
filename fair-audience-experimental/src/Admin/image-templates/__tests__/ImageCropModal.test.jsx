/**
 * @jest-environment jsdom
 *
 * Component tests for the crop dialog on the Image Templates page (#1913):
 * the cropper is locked to the slot's aspect ratio, Crop stays disabled
 * until the cropper reports a crop area, and confirming hands back the
 * latest area in pixels (not percentages), which the page sends to the
 * server as crop_x/crop_y/crop_width/crop_height.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ImageCropModal from '../ImageCropModal.js';

const mockCropper = { props: null };

// The real cropper measures the image in the browser, which jsdom can't do.
// This stand-in records the props it receives so a test can drive its
// callbacks the way the library does.
jest.mock( 'react-easy-crop', () => ( {
	__esModule: true,
	default: ( props ) => {
		mockCropper.props = props;
		return <div data-testid="cropper" />;
	},
} ) );

const IMAGE_URL = 'https://example.com/photo.jpg';

function renderModal( overrides = {} ) {
	const onCrop = jest.fn();
	const onClose = jest.fn();
	render(
		<ImageCropModal
			imageUrl={ IMAGE_URL }
			width={ 1200 }
			height={ 600 }
			onCrop={ onCrop }
			onClose={ onClose }
			{ ...overrides }
		/>
	);
	return { onCrop, onClose };
}

function completeCrop( percentages, pixels ) {
	act( () => {
		mockCropper.props.onCropComplete( percentages, pixels );
	} );
}

describe( 'ImageCropModal', () => {
	beforeEach( () => {
		mockCropper.props = null;
	} );

	it( 'shows the slot size and locks the cropper to its aspect ratio', () => {
		renderModal();

		expect(
			screen.getByRole( 'dialog', { name: 'Crop image (1200×600)' } )
		).toBeInTheDocument();
		expect( mockCropper.props.image ).toBe( IMAGE_URL );
		expect( mockCropper.props.aspect ).toBe( 2 );
	} );

	it( 'keeps Crop disabled until the cropper reports a crop area', () => {
		const { onCrop } = renderModal();
		const cropButton = screen.getByRole( 'button', { name: 'Crop' } );

		expect( cropButton ).toBeDisabled();
		fireEvent.click( cropButton );
		expect( onCrop ).not.toHaveBeenCalled();

		completeCrop(
			{ x: 0, y: 0, width: 100, height: 50 },
			{ x: 0, y: 0, width: 1600, height: 800 }
		);

		expect( cropButton ).toBeEnabled();
	} );

	it( 'confirms with the latest crop area in pixels', () => {
		const { onCrop, onClose } = renderModal();

		completeCrop(
			{ x: 0, y: 0, width: 100, height: 50 },
			{ x: 0, y: 0, width: 1600, height: 800 }
		);
		completeCrop(
			{ x: 12.5, y: 20, width: 50, height: 25 },
			{ x: 200, y: 160, width: 800, height: 400 }
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Crop' } ) );

		expect( onCrop ).toHaveBeenCalledTimes( 1 );
		expect( onCrop ).toHaveBeenCalledWith( {
			x: 200,
			y: 160,
			width: 800,
			height: 400,
		} );
		expect( onClose ).not.toHaveBeenCalled();
	} );

	it( 'closes without confirming when Cancel is clicked', () => {
		const { onCrop, onClose } = renderModal();

		completeCrop(
			{ x: 0, y: 0, width: 100, height: 50 },
			{ x: 0, y: 0, width: 1600, height: 800 }
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( onClose ).toHaveBeenCalledTimes( 1 );
		expect( onCrop ).not.toHaveBeenCalled();
	} );

	it( 'passes pan and zoom changes back to the cropper', () => {
		renderModal();

		expect( mockCropper.props.crop ).toEqual( { x: 0, y: 0 } );
		expect( mockCropper.props.zoom ).toBe( 1 );

		act( () => {
			mockCropper.props.onCropChange( { x: -40, y: 25 } );
			mockCropper.props.onZoomChange( 2.5 );
		} );

		expect( mockCropper.props.crop ).toEqual( { x: -40, y: 25 } );
		expect( mockCropper.props.zoom ).toBe( 2.5 );
	} );
} );
