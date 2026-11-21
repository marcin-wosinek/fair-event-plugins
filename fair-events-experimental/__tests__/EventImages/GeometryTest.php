<?php
/**
 * Focal-region circle validation.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\EventImages;

use FairEventsExperimental\EventImages\Geometry;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers the coordinate contract in docs/event-images.md. */
class GeometryTest extends TestCase {

	/** @return array<string, array{0: mixed, 1: int|null, 2: int|null, 3: string}> */
	public static function refused() {
		return array(
			'not an array'          => array( 'circle', 400, 100, 'malformed' ),
			'missing key'           => array(
				array(
					'centerX' => 0.5,
					'centerY' => 0.5,
				),
				400,
				100,
				'malformed',
			),
			'non-numeric'           => array(
				array(
					'centerX' => 'a',
					'centerY' => 0.5,
					'radius'  => 0.1,
				),
				400,
				100,
				'malformed',
			),
			'boolean'               => array(
				array(
					'centerX' => true,
					'centerY' => 0.5,
					'radius'  => 0.1,
				),
				400,
				100,
				'malformed',
			),
			'infinite'              => array(
				array(
					'centerX' => INF,
					'centerY' => 0.5,
					'radius'  => 0.1,
				),
				400,
				100,
				'malformed',
			),
			'unknown dimensions'    => array(
				array(
					'centerX' => 0.5,
					'centerY' => 0.5,
					'radius'  => 0.1,
				),
				null,
				null,
				'dimensions_unknown',
			),
			'zero radius'           => array(
				array(
					'centerX' => 0.5,
					'centerY' => 0.5,
					'radius'  => 0,
				),
				400,
				100,
				'radius_not_positive',
			),
			'past the top'          => array(
				array(
					'centerX' => 0.5,
					'centerY' => 0.4,
					'radius'  => 0.5,
				),
				400,
				100,
				'outside_image',
			),
			'past the left'         => array(
				array(
					'centerX' => 0.1,
					'centerY' => 0.5,
					'radius'  => 0.5,
				),
				400,
				100,
				'outside_image',
			),
			'centre outside'        => array(
				array(
					'centerX' => 1.1,
					'centerY' => 0.5,
					'radius'  => 0.01,
				),
				400,
				100,
				'outside_image',
			),
			'portrait, past bottom' => array(
				array(
					'centerX' => 0.5,
					'centerY' => 0.8,
					'radius'  => 0.5,
				),
				200,
				300,
				'outside_image',
			),
		);
	}

	/** Each refused circle reports why. */
	#[DataProvider( 'refused' )]
	public function test_refuses( $raw, $width, $height, $code ) {
		$result = Geometry::validate( $raw, $width, $height );
		$this->assertFalse( $result['ok'] );
		$this->assertSame( $code, $result['code'] );
	}

	/** Radius is a fraction of the shorter side, so 0.5 touches both long edges. */
	public function test_accepts_largest_fitting_circle_and_rounds() {
		$result = Geometry::validate(
			array(
				'centerX' => '0.125',
				'centerY' => 0.5,
				'radius'  => 0.50000000004,
			),
			400,
			100
		);
		$this->assertTrue( $result['ok'] );
		$this->assertSame(
			array(
				'centerX' => 0.125,
				'centerY' => 0.5,
				'radius'  => 0.5,
			),
			$result['circle']
		);
	}

	/** The same circle is valid for any proportional resize of the source. */
	public function test_is_scale_independent() {
		$circle = array(
			'centerX' => 0.3,
			'centerY' => 0.6,
			'radius'  => 0.25,
		);
		foreach ( array( array( 300, 200 ), array( 3000, 2000 ), array( 150, 100 ) ) as $size ) {
			$this->assertTrue( Geometry::validate( $circle, $size[0], $size[1] )['ok'] );
		}
	}
}
