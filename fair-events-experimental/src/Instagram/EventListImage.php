<?php
/**
 * Image of a scheduled Instagram event-list post
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Draws a weekly summary as one portrait JPEG (1080 × 1350, Instagram's 4:5):
 * the page title, the week's dates, and each event's day and time above its
 * name, in dark text on a plain light background.
 *
 * The text is set in DM Sans (SIL Open Font License, bundled in
 * assets/fonts), which covers accented Latin letters. Text is measured
 * before anything is drawn. When the whole list does not fit at the
 * smallest readable size, nothing is drawn and an error explains why:
 * events are never left out or cut short.
 */
class EventListImage {

	const WIDTH   = 1080;
	const HEIGHT  = 1350;
	const MARGIN  = 80;
	const QUALITY = 90;

	/**
	 * Sizes in points at full scale, and the scales tried from largest to
	 * smallest. The smallest keeps event names at 26 pt, readable on a phone.
	 */
	const HEADING_SIZE = 60;
	const RANGE_SIZE   = 34;
	const WHEN_SIZE    = 28;
	const TITLE_SIZE   = 40;
	const SCALES       = array( 1.0, 0.9, 0.8, 0.72, 0.65 );

	const LINE_HEIGHT = 1.3;

	const BACKGROUND = array( 0xF7, 0xF4, 0xEE );
	const TEXT       = array( 0x1D, 0x23, 0x27 );
	const ACCENT     = array( 0x8A, 0x3B, 0x12 );
	const MUTED      = array( 0x50, 0x57, 0x5E );

	/**
	 * Font files.
	 *
	 * @var array{regular: string, bold: string}
	 */
	private $fonts;

	/**
	 * Constructor.
	 *
	 * @param array|null $fonts Font files, or null for the bundled ones.
	 */
	public function __construct( $fonts = null ) {
		$dir         = dirname( __DIR__, 2 ) . '/assets/fonts/';
		$this->fonts = $fonts ? $fonts : array(
			'regular' => $dir . 'DMSans-Regular.ttf',
			'bold'    => $dir . 'DMSans-Bold.ttf',
		);
	}

	/**
	 * Whether this server can draw the image.
	 *
	 * @return bool
	 */
	public function supported() {
		return function_exists( 'imagecreatetruecolor' ) && function_exists( 'imagettftext' ) && function_exists( 'imagejpeg' )
			&& is_readable( $this->fonts['regular'] ) && is_readable( $this->fonts['bold'] );
	}

	/**
	 * Draw the image.
	 *
	 * @param array $summary Summary with title, range and events (when, title).
	 * @return array{jpeg: string, width: int, height: int, scale: float}|WP_Error
	 */
	public function render( array $summary ) {
		if ( ! $this->supported() ) {
			return new WP_Error(
				'instagram_image_unsupported',
				__( 'This server cannot draw the Instagram image: PHP’s GD extension with FreeType support is missing. Ask your host to enable it. Nothing was published.', 'fair-events-experimental' )
			);
		}

		$layout = $this->layout( $summary );
		if ( is_wp_error( $layout ) ) {
			return $layout;
		}

		$image = imagecreatetruecolor( self::WIDTH, self::HEIGHT );
		if ( ! $image ) {
			return new WP_Error( 'instagram_image_failed', __( 'The Instagram image could not be drawn. Nothing was published.', 'fair-events-experimental' ) );
		}
		imagefill( $image, 0, 0, $this->color( $image, self::BACKGROUND ) );

		foreach ( $layout['lines'] as $line ) {
			imagettftext( $image, $line['size'], 0, self::MARGIN, (int) round( $line['baseline'] ), $this->color( $image, $line['color'] ), $this->fonts[ $line['font'] ], $line['text'] );
		}

		ob_start();
		imagejpeg( $image, null, self::QUALITY );
		$jpeg = (string) ob_get_clean();

		if ( '' === $jpeg ) {
			return new WP_Error( 'instagram_image_failed', __( 'The Instagram image could not be drawn. Nothing was published.', 'fair-events-experimental' ) );
		}

		return array(
			'jpeg'   => $jpeg,
			'width'  => self::WIDTH,
			'height' => self::HEIGHT,
			'scale'  => $layout['scale'],
		);
	}

	/**
	 * Lines and their positions at the largest scale where everything fits.
	 *
	 * @param array $summary Summary.
	 * @return array{scale: float, lines: array[]}|WP_Error
	 */
	public function layout( array $summary ) {
		$events = array_values( (array) ( $summary['events'] ?? array() ) );
		$bottom = self::HEIGHT - self::MARGIN;

		foreach ( self::SCALES as $scale ) {
			$lines = $this->lines( $summary, $events, $scale );
			$last  = end( $lines );
			if ( false === $last || $last['bottom'] <= $bottom ) {
				return array(
					'scale' => $scale,
					'lines' => $lines,
				);
			}
		}

		return new WP_Error(
			'instagram_list_too_long',
			sprintf(
				/* translators: %d: number of events in the week */
				_n(
					'The week’s %d event does not fit readably in one Instagram image. Nothing was published. Shorten the event name or choose an event feed with fewer events for this notification.',
					'The week’s %d events do not fit readably in one Instagram image. Nothing was published. Choose an event feed with fewer events for this notification, or shorten the event names.',
					count( $events ),
					'fair-events-experimental'
				),
				count( $events )
			)
		);
	}

	/**
	 * Every line at one scale, with its baseline and bottom edge.
	 *
	 * @param array   $summary Summary.
	 * @param array[] $events  Events.
	 * @param float   $scale   Scale.
	 * @return array[]
	 */
	private function lines( array $summary, array $events, $scale ) {
		$lines  = array();
		$cursor = (float) self::MARGIN;

		$title = trim( (string) ( $summary['title'] ?? '' ) );
		if ( '' !== $title ) {
			$cursor  = $this->add( $lines, $cursor, $title, 'bold', self::HEADING_SIZE * $scale, self::TEXT );
			$cursor += 16 * $scale;
		}
		$cursor  = $this->add( $lines, $cursor, trim( (string) ( $summary['range'] ?? '' ) ), 'regular', self::RANGE_SIZE * $scale, self::MUTED );
		$cursor += 40 * $scale;

		foreach ( $events as $event ) {
			$cursor += 18 * $scale;
			$cursor  = $this->add( $lines, $cursor, trim( (string) ( $event['when'] ?? '' ) ), 'bold', self::WHEN_SIZE * $scale, self::ACCENT );
			$name    = trim( (string) ( $event['title'] ?? '' ) );
			$cursor  = $this->add( $lines, $cursor, '' !== $name ? $name : __( '(no title)', 'fair-events-experimental' ), 'regular', self::TITLE_SIZE * $scale, self::TEXT );
		}

		return $lines;
	}

	/**
	 * Wrap a text into lines at the cursor.
	 *
	 * @param array[] $lines  Lines so far.
	 * @param float   $cursor Top of the next line.
	 * @param string  $text   Text.
	 * @param string  $font   'regular' or 'bold'.
	 * @param float   $size   Size in points.
	 * @param int[]   $color  RGB.
	 * @return float Top of the line after them.
	 */
	private function add( array &$lines, $cursor, $text, $font, $size, array $color ) {
		$height = $size * self::LINE_HEIGHT;
		$text   = self::drawable( $text );
		foreach ( $this->wrap( $text, $font, $size ) as $row ) {
			$lines[] = array(
				'text'     => $row,
				'font'     => $font,
				'size'     => $size,
				'color'    => $color,
				// The baseline sits about four fifths down a line.
				'baseline' => $cursor + $height * 0.78,
				'bottom'   => $cursor + $height,
			);
			$cursor += $height;
		}
		return $cursor;
	}

	/**
	 * A text without emoji, which the bundled font cannot draw and would show
	 * as empty boxes. The caption keeps them.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	public static function drawable( $text ) {
		$text = (string) preg_replace( '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE00}-\x{FE0F}\x{200D}\x{20E3}\x{E0020}-\x{E007F}]/u', '', (string) $text );
		return trim( (string) preg_replace( '/\s{2,}/u', ' ', $text ) );
	}

	/**
	 * Break a text into rows that fit the width, between words when possible.
	 *
	 * @param string $text Text.
	 * @param string $font 'regular' or 'bold'.
	 * @param float  $size Size in points.
	 * @return string[]
	 */
	public function wrap( $text, $font, $size ) {
		$width = self::WIDTH - 2 * self::MARGIN;
		$words = preg_split( '/\s+/u', trim( (string) $text ), -1, PREG_SPLIT_NO_EMPTY );
		$rows  = array();
		$row   = '';

		foreach ( $words ? $words : array( '' ) as $word ) {
			$candidate = '' === $row ? $word : $row . ' ' . $word;
			if ( $this->measure( $candidate, $font, $size ) <= $width ) {
				$row = $candidate;
				continue;
			}
			if ( '' !== $row ) {
				$rows[] = $row;
			}
			// A word wider than the image is broken between characters.
			$row = '';
			foreach ( preg_split( '//u', $word, -1, PREG_SPLIT_NO_EMPTY ) as $character ) {
				if ( '' !== $row && $this->measure( $row . $character, $font, $size ) > $width ) {
					$rows[] = $row;
					$row    = '';
				}
				$row .= $character;
			}
		}
		$rows[] = $row;

		return $rows;
	}

	/**
	 * Width of a text in pixels.
	 *
	 * @param string $text Text.
	 * @param string $font 'regular' or 'bold'.
	 * @param float  $size Size in points.
	 * @return float
	 */
	private function measure( $text, $font, $size ) {
		$box = imagettfbbox( $size, 0, $this->fonts[ $font ], $text );
		return $box ? (float) ( max( $box[2], $box[4] ) - min( $box[0], $box[6] ) ) : PHP_INT_MAX;
	}

	/**
	 * Allocate a color.
	 *
	 * @param \GdImage $image Image.
	 * @param int[]    $rgb   RGB.
	 * @return int
	 */
	private function color( $image, array $rgb ) {
		return (int) imagecolorallocate( $image, $rgb[0], $rgb[1], $rgb[2] );
	}
}
