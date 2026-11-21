/**
 * Focal Region Editor
 *
 * Shows an image with its focal circle. The circle moves by dragging it and
 * grows or shrinks with its handle (mouse, pen or touch); the same values
 * are editable with labelled sliders, so the keyboard reaches everything.
 * The parent owns the circle: every change is reported through onChange and
 * rendered back from props, so the preview and the saved values are one.
 *
 * @package FairEventsExperimental
 */

import { useRef } from '@wordpress/element';
import { RangeControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	MAX_RADIUS,
	MIN_RADIUS,
	circleStyle,
	clampCircle,
} from './imagesModel.js';

const percent = ( value ) => Math.round( value * 1000 ) / 10;

/** Largest preview, in CSS pixels. */
const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 360;

/**
 * Preview box size for an image of known size: fits PREVIEW_WIDTH ×
 * PREVIEW_HEIGHT without upscaling, and keeps the aspect ratio when the
 * screen is narrower.
 *
 * @param {number|null} width  Oriented width.
 * @param {number|null} height Oriented height.
 * @return {Object} Inline style.
 */
const previewSize = ( width, height ) => {
	if ( ! width || ! height ) {
		return {};
	}
	const scale = Math.min( 1, PREVIEW_WIDTH / width, PREVIEW_HEIGHT / height );
	return {
		width: `${ Math.round( width * scale ) }px`,
		aspectRatio: `${ width } / ${ height }`,
	};
};

export default function FocalRegionEditor( {
	sourceUrl,
	alt,
	width,
	height,
	circle,
	onChange,
	disabled = false,
	idPrefix,
} ) {
	const boxRef = useRef( null );
	const dragRef = useRef( null );

	const update = ( changes ) =>
		onChange( clampCircle( { ...circle, ...changes }, width, height ) );

	const startDrag = ( mode ) => ( event ) => {
		if ( disabled || ! circle || ! boxRef.current ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const rect = boxRef.current.getBoundingClientRect();
		dragRef.current = {
			mode,
			rect,
			startX: event.clientX,
			startY: event.clientY,
			circle,
		};
		event.currentTarget.setPointerCapture?.( event.pointerId );
	};

	const onPointerMove = ( event ) => {
		const drag = dragRef.current;
		if ( ! drag ) {
			return;
		}
		event.preventDefault();
		const { rect } = drag;
		if ( ! rect.width || ! rect.height ) {
			return;
		}
		if ( drag.mode === 'move' ) {
			update( {
				centerX:
					drag.circle.centerX +
					( event.clientX - drag.startX ) / rect.width,
				centerY:
					drag.circle.centerY +
					( event.clientY - drag.startY ) / rect.height,
			} );
		} else {
			const centerX = rect.left + drag.circle.centerX * rect.width;
			const centerY = rect.top + drag.circle.centerY * rect.height;
			const distance = Math.hypot(
				event.clientX - centerX,
				event.clientY - centerY
			);
			update( {
				radius: distance / Math.min( rect.width, rect.height ),
			} );
		}
	};

	const endDrag = () => {
		dragRef.current = null;
	};

	return (
		<div className="fair-events-images-editor">
			<div
				className="fair-events-images-preview"
				ref={ boxRef }
				onPointerMove={ onPointerMove }
				onPointerUp={ endDrag }
				onPointerCancel={ endDrag }
				// Keep the page from scrolling while a finger drags the circle.
				style={ {
					...previewSize( width, height ),
					...( circle && ! disabled ? { touchAction: 'none' } : {} ),
				} }
			>
				<img src={ sourceUrl } alt={ alt || '' } draggable={ false } />
				{ circle && (
					<div
						className="fair-events-images-circle"
						style={ circleStyle( circle, width, height ) }
						onPointerDown={ startDrag( 'move' ) }
						aria-hidden="true"
						data-testid="focal-circle"
					>
						{ ! disabled && (
							<span
								className="fair-events-images-handle"
								onPointerDown={ startDrag( 'resize' ) }
								data-testid="focal-handle"
							/>
						) }
					</div>
				) }
			</div>

			{ circle && ! disabled && (
				<div className="fair-events-images-sliders">
					<RangeControl
						id={ `${ idPrefix }-x` }
						label={ __(
							'Circle centre, from the left (%)',
							'fair-events-experimental'
						) }
						value={ percent( circle.centerX ) }
						onChange={ ( value ) =>
							update( { centerX: ( value ?? 50 ) / 100 } )
						}
						min={ 0 }
						max={ 100 }
						step={ 0.5 }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<RangeControl
						id={ `${ idPrefix }-y` }
						label={ __(
							'Circle centre, from the top (%)',
							'fair-events-experimental'
						) }
						value={ percent( circle.centerY ) }
						onChange={ ( value ) =>
							update( { centerY: ( value ?? 50 ) / 100 } )
						}
						min={ 0 }
						max={ 100 }
						step={ 0.5 }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<RangeControl
						id={ `${ idPrefix }-r` }
						label={ __(
							'Circle radius, % of the shorter side',
							'fair-events-experimental'
						) }
						value={ percent( circle.radius ) }
						onChange={ ( value ) =>
							update( { radius: ( value ?? 25 ) / 100 } )
						}
						min={ MIN_RADIUS * 100 }
						max={ MAX_RADIUS * 100 }
						step={ 0.5 }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
				</div>
			) }
		</div>
	);
}
