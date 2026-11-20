<?php
/**
 * Tests for the scheduled Instagram post's caption and image.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Instagram\EventListCaption;
use FairEventsExperimental\Instagram\EventListImage;
use PHPUnit\Framework\TestCase;

/**
 * The caption lists every event, the image fits them readably or refuses,
 * and accented text is kept as it is.
 */
class EventListPostTest extends TestCase {

	/**
	 * A summary as Fair Events' SummaryBuilder returns it.
	 *
	 * @param int    $count Number of events.
	 * @param string $title Event title.
	 * @return array
	 */
	private function summary( $count, $title = 'Taller de malabares' ) {
		$events = array();
		for ( $i = 1; $i <= $count; $i++ ) {
			$events[] = array(
				'when'  => 'lun, 18:00',
				'title' => $title . ' ' . $i,
				'url'   => 'https://example.test/event-' . $i . '/',
			);
		}
		return array(
			'title'            => 'Agenda — Łódź',
			'range'            => '14 – 20 sep 2026',
			'url'              => 'https://example.test/agenda/',
			'occurrence_count' => $count,
			'events'           => $events,
		);
	}

	/** Caption lists every event and the page link. */
	public function test_caption_lists_every_event_and_the_page_link() {
		$caption = EventListCaption::format( $this->summary( 2 ) );

		$this->assertSame(
			"Agenda — Łódź\n14 – 20 sep 2026\n\n• lun, 18:00, Taller de malabares 1\n• lun, 18:00, Taller de malabares 2\n\nhttps://example.test/agenda/",
			$caption
		);
	}

	/** Caption keeps decoded titles as they are. */
	public function test_caption_keeps_decoded_titles_as_they_are() {
		$summary                       = $this->summary( 1 );
		$summary['events'][0]['title'] = 'Rock & Roll &amp; más ąęłń';

		$this->assertStringContainsString( 'Rock & Roll &amp; más ąęłń', EventListCaption::format( $summary ) );
	}

	/** Caption refuses rather than shortens. */
	public function test_caption_refuses_rather_than_shortens() {
		$caption = EventListCaption::format( $this->summary( 60, str_repeat( 'Muy largo ', 5 ) ) );

		$this->assertInstanceOf( \WP_Error::class, $caption );
		$this->assertSame( 'instagram_caption_too_long', $caption->get_error_code() );
	}

	/** Caption refuses too many hashtags. */
	public function test_caption_refuses_too_many_hashtags() {
		$summary                       = $this->summary( 1 );
		$summary['events'][0]['title'] = implode( ' ', array_map( static fn( $i ) => '#tag' . $i, range( 1, 31 ) ) );

		$this->assertSame( 'instagram_caption_hashtags', EventListCaption::format( $summary )->get_error_code() );
	}

	/** Caption leaves out an unusable link. */
	public function test_caption_leaves_out_an_unusable_link() {
		$summary        = $this->summary( 1 );
		$summary['url'] = 'javascript:alert(1)';

		$this->assertStringNotContainsString( 'javascript', EventListCaption::format( $summary ) );
	}

	/**
	 * Skip when this PHP cannot draw text.
	 *
	 * @return EventListImage
	 */
	private function image() {
		$image = new EventListImage();
		if ( ! $image->supported() ) {
			$this->markTestSkipped( 'GD with FreeType is not available.' );
		}
		return $image;
	}

	/** Image is a portrait jpeg. */
	public function test_image_is_a_portrait_jpeg() {
		$result = $this->image()->render( $this->summary( 5, 'Taller für Anfänger ąęłńśźż ¿Qué?' ) );

		$this->assertIsArray( $result );
		$this->assertSame( 1080, $result['width'] );
		$this->assertSame( 1350, $result['height'] );
		$size = getimagesizefromstring( $result['jpeg'] );
		$this->assertSame( array( 1080, 1350 ), array( $size[0], $size[1] ) );
		$this->assertSame( 'image/jpeg', $size['mime'] );
	}

	/** Image shrinks text before refusing. */
	public function test_image_shrinks_text_before_refusing() {
		$image = $this->image();

		$this->assertSame( 1.0, $image->layout( $this->summary( 3 ) )['scale'] );
		$this->assertLessThan( 1.0, $image->layout( $this->summary( 10 ) )['scale'] );
	}

	/** Image refuses a list that does not fit. */
	public function test_image_refuses_a_list_that_does_not_fit() {
		$layout = $this->image()->layout( $this->summary( 40 ) );

		$this->assertInstanceOf( \WP_Error::class, $layout );
		$this->assertSame( 'instagram_list_too_long', $layout->get_error_code() );
	}

	/** Long titles wrap without losing text. */
	public function test_long_titles_wrap_without_losing_text() {
		$image = $this->image();
		$title = 'Encuentro internacional de malabaristas, acróbatas y artistas de circo contemporáneo';
		$rows  = $image->wrap( $title, 'regular', 40 );

		$this->assertGreaterThan( 1, count( $rows ) );
		$this->assertSame( $title, implode( ' ', $rows ) );
	}

	/** Emoji are left out of the image only. */
	public function test_emoji_are_left_out_of_the_image_only() {
		$this->assertSame( 'Jam & más ąę', EventListImage::drawable( 'Jam 🎉 & más ąę ☀️' ) );

		$summary                       = $this->summary( 1 );
		$summary['events'][0]['title'] = 'Jam 🎉';
		$this->assertStringContainsString( 'Jam 🎉', EventListCaption::format( $summary ) );
	}

	/** A word wider than the image is broken. */
	public function test_a_word_wider_than_the_image_is_broken() {
		$word = str_repeat( 'ż', 80 );
		$rows = $this->image()->wrap( $word, 'bold', 40 );

		$this->assertGreaterThan( 1, count( $rows ) );
		$this->assertSame( $word, implode( '', $rows ) );
	}
}
