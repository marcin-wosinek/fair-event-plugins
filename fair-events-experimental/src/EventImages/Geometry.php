<?php
/**
 * Focal-region circle validation.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\EventImages;

defined( 'WPINC' ) || die;

/**
 * A focal region is a circle on the image as displayed (oriented).
 *
 * The origin is the top-left corner. `centerX` is a fraction of the width
 * and `centerY` a fraction of the height; `radius` is a fraction of the
 * shorter side. Because every value is relative, the circle applies to any
 * proportional resize of the same source. In pixels of a W × H image the
 * circle is centred at (centerX·W, centerY·H) with radius radius·min(W, H),
 * and the whole circle must lie inside the image.
 */
class Geometry {

	/**
	 * Decimal places stored and returned.
	 */
	public const PRECISION = 6;

	/**
	 * Tolerance in pixels for the fit check, so a circle the editor clamped
	 * to an edge is not refused over float rounding.
	 */
	private const EPSILON_PX = 0.01;

	/**
	 * Validate a submitted circle against the oriented source dimensions.
	 *
	 * @param mixed    $raw    Submitted `focalRegion` (array with centerX, centerY, radius).
	 * @param int|null $width  Oriented width in pixels, null when unknown.
	 * @param int|null $height Oriented height in pixels, null when unknown.
	 * @return array{ok: bool, code?: string, circle?: array{centerX: float, centerY: float, radius: float}}
	 */
	public static function validate( $raw, $width, $height ) {
		if ( ! is_array( $raw ) ) {
			return array(
				'ok'   => false,
				'code' => 'malformed',
			);
		}

		$values = array();
		foreach ( array( 'centerX', 'centerY', 'radius' ) as $key ) {
			if ( ! array_key_exists( $key, $raw ) || is_bool( $raw[ $key ] ) || ! is_numeric( $raw[ $key ] ) ) {
				return array(
					'ok'   => false,
					'code' => 'malformed',
				);
			}
			$value = (float) $raw[ $key ];
			if ( ! is_finite( $value ) ) {
				return array(
					'ok'   => false,
					'code' => 'malformed',
				);
			}
			$values[ $key ] = round( $value, self::PRECISION );
		}

		if ( ! $width || ! $height ) {
			return array(
				'ok'   => false,
				'code' => 'dimensions_unknown',
			);
		}

		if ( $values['radius'] <= 0 ) {
			return array(
				'ok'   => false,
				'code' => 'radius_not_positive',
			);
		}

		$radius_px = $values['radius'] * min( $width, $height );
		$center_x  = $values['centerX'] * $width;
		$center_y  = $values['centerY'] * $height;

		if (
			$center_x - $radius_px < -self::EPSILON_PX
			|| $center_x + $radius_px > $width + self::EPSILON_PX
			|| $center_y - $radius_px < -self::EPSILON_PX
			|| $center_y + $radius_px > $height + self::EPSILON_PX
		) {
			return array(
				'ok'   => false,
				'code' => 'outside_image',
			);
		}

		return array(
			'ok'     => true,
			'circle' => $values,
		);
	}
}
