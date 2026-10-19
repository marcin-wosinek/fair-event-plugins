<?php
/**
 * Meta purchase event-context tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\PurchaseContext;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers occurrence selection, identifier mapping and missing context. */
class PurchaseContextTest extends TestCase {
	/**
	 * An EventDates stand-in.
	 *
	 * @param int         $id      Event date ID.
	 * @param string|null $start   Local start datetime.
	 * @param int|null    $post_id Resolved post ID, or null when unlinked.
	 * @param string|null $title   Display title.
	 * @param string      $type    Occurrence type.
	 * @param int|null    $master  Master ID.
	 * @return object
	 */
	private function occurrence( $id, $start, $post_id = null, $title = 'Mix &amp; Move', $type = 'single', $master = null ) {
		return new class( $id, $start, $post_id, $title, $type, $master ) {
			/** @var int */
			public $id;
			/** @var string|null */
			public $start_date;
			/** @var string|null */
			public $start_time;
			/** @var bool */
			public $all_day = false;
			/** @var string */
			public $occurrence_type;
			/** @var int|null */
			public $master_id;
			/** @var int|null */
			private $post_id;
			/** @var string|null */
			private $title;

			/**
			 * @param int         $id      ID.
			 * @param string|null $start   Start.
			 * @param int|null    $post_id Post ID.
			 * @param string|null $title   Title.
			 * @param string      $type    Type.
			 * @param int|null    $master  Master ID.
			 */
			public function __construct( $id, $start, $post_id, $title, $type, $master ) {
				$this->id              = $id;
				$this->start_date      = $start ? substr( $start, 0, 10 ) : null;
				$this->start_time      = $start ? substr( $start, 11, 8 ) : null;
				$this->post_id         = $post_id;
				$this->title           = $title;
				$this->occurrence_type = $type;
				$this->master_id       = $master;
			}

			/** @return int|null */
			public function get_resolved_event_id() {
				return $this->post_id;
			}

			/** @return string|null */
			public function get_display_title() {
				return $this->title;
			}
		};
	}

	/**
	 * A resolver backed by in-memory registrations and occurrences.
	 *
	 * @param int[]    $signup_ids  Resolved signup IDs.
	 * @param array    $signups     Signup ID => [transaction_id, event_date_id].
	 * @param object[] $occurrences Event date ID => occurrence.
	 * @param string[] $posts       Post ID => post title.
	 * @return PurchaseContext
	 */
	private function resolver( $signup_ids, $signups, $occurrences, $posts = array() ) {
		return new class( $signup_ids, $signups, $occurrences, $posts ) extends PurchaseContext {
			/** @var array */
			private $data;

			/**
			 * @param int[]    $signup_ids  Signup IDs.
			 * @param array    $signups     Signups.
			 * @param object[] $occurrences Occurrences.
			 * @param string[] $posts       Post titles.
			 */
			public function __construct( $signup_ids, $signups, $occurrences, $posts ) {
				$this->data = compact( 'signup_ids', 'signups', 'occurrences', 'posts' );
			}

			/** @param int $post_id Post ID. @return string|null */
			protected function post_title( $post_id ) {
				return $this->data['posts'][ $post_id ] ?? null;
			}

			/** @return bool */
			protected function available() {
				return true;
			}

			/**
			 * @param object $transaction Transaction.
			 * @return int[]
			 * @throws \Throwable When the test supplies one.
			 */
			protected function signup_ids( $transaction ) {
				unset( $transaction );
				if ( $this->data['signup_ids'] instanceof \Throwable ) {
					throw $this->data['signup_ids'];
				}
				return $this->data['signup_ids'];
			}

			/** @param int $signup_id Signup ID. @return object|null */
			protected function signup( $signup_id ) {
				$signup = $this->data['signups'][ $signup_id ] ?? null;
				return $signup ? (object) array(
					'id'             => $signup_id,
					'transaction_id' => $signup[0],
					'event_date_id'  => $signup[1],
				) : null;
			}

			/** @param int $event_date_id Event date ID. @return object|null */
			protected function occurrence( $event_date_id ) {
				return $this->data['occurrences'][ $event_date_id ] ?? null;
			}
		};
	}

	/** @return object */
	private function transaction() {
		return (object) array( 'id' => 42 );
	}

	/** A single-occurrence purchase reports its post, title, occurrence and local date. */
	public function test_single_occurrence_maps_to_meta_parameters() {
		$context = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 30 ) ),
			array( 30 => $this->occurrence( 30, '2026-11-05 19:30:00', 12 ) )
		)->for_transaction( $this->transaction() );
		$this->assertSame(
			array(
				'content_name'     => 'Mix & Move',
				'content_ids'      => array( '12' ),
				'event_date_id'    => 30,
				'event_start_date' => '2026-11-05',
			),
			$context
		);
	}

	/** The linked post's title is used even when the row's display title is unset. */
	public function test_post_title_wins_over_missing_display_title() {
		$context = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 30 ) ),
			array( 30 => $this->occurrence( 30, '2026-11-05 19:30:00', 12, null ) ),
			array( 12 => 'Salsa <b>night</b>' )
		)->for_transaction( $this->transaction() );
		$this->assertSame( 'Salsa night', $context['content_name'] );
	}

	/** A generated session reports its own ID and date, with the series' post as the event. */
	public function test_generated_occurrence_uses_resolved_post() {
		$context = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 31 ) ),
			array( 31 => $this->occurrence( 31, '2026-11-12 19:30:00', 12, 'Mix &amp; Move', 'generated', 30 ) )
		)->for_transaction( $this->transaction() );
		$this->assertSame( array( '12' ), $context['content_ids'] );
		$this->assertSame( 31, $context['event_date_id'] );
		$this->assertSame( '2026-11-12', $context['event_start_date'] );
	}

	/** Two sessions of one event share the event ID but stay distinguishable by occurrence. */
	public function test_occurrences_of_one_event_are_distinguishable() {
		$occurrences = array(
			30 => $this->occurrence( 30, '2026-11-05 19:30:00', 12, 'Mix', 'master' ),
			31 => $this->occurrence( 31, '2026-11-12 19:30:00', 12, 'Mix', 'generated', 30 ),
		);
		$first       = $this->resolver( array( 1 ), array( 1 => array( 42, 30 ) ), $occurrences )->for_transaction( $this->transaction() );
		$second      = $this->resolver( array( 2 ), array( 2 => array( 42, 31 ) ), $occurrences )->for_transaction( $this->transaction() );
		$this->assertSame( $first['content_ids'], $second['content_ids'] );
		$this->assertNotSame( $first['event_date_id'], $second['event_date_id'] );
		$this->assertNotSame( $first['event_start_date'], $second['event_start_date'] );
	}

	/** An unlinked event is identified by its master or single date row. */
	public function test_unlinked_events_use_event_date_identifier() {
		$generated = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 31 ) ),
			array( 31 => $this->occurrence( 31, '2026-11-12 19:30:00', null, 'Jam', 'generated', 30 ) )
		)->for_transaction( $this->transaction() );
		$single    = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 40 ) ),
			array( 40 => $this->occurrence( 40, '2026-11-12 19:30:00', null, 'Jam' ) )
		)->for_transaction( $this->transaction() );
		$this->assertSame( array( 'event-date:30' ), $generated['content_ids'] );
		$this->assertSame( array( 'event-date:40' ), $single['content_ids'] );
	}

	/** A multi-occurrence purchase reports only its earliest registered occurrence, wherever it is listed. */
	public function test_multiple_occurrences_report_the_earliest_only() {
		$context = $this->resolver(
			array( 1, 2, 3 ),
			array(
				1 => array( 42, 33 ),
				2 => array( 42, 31 ),
				3 => array( 42, 32 ),
			),
			array(
				31 => $this->occurrence( 31, '2026-11-12 19:30:00', 12, 'Mix', 'generated', 30 ),
				32 => $this->occurrence( 32, '2026-11-19 19:30:00', 12, 'Mix', 'generated', 30 ),
				33 => $this->occurrence( 33, '2026-11-26 19:30:00', 12, 'Mix', 'generated', 30 ),
			)
		)->for_transaction( $this->transaction() );
		$this->assertSame( 31, $context['event_date_id'] );
		$this->assertSame( '2026-11-12', $context['event_start_date'] );
		$this->assertSame( array( '12' ), $context['content_ids'] );
	}

	/** Equal starts go to the lower ID; an occurrence without a start sorts last. */
	public function test_select_occurrence_tie_break_and_missing_start() {
		$selected = PurchaseContext::select_occurrence(
			array(
				$this->occurrence( 9, null ),
				$this->occurrence( 8, '2026-11-12 19:30:00' ),
				$this->occurrence( 5, '2026-11-12 19:30:00' ),
			)
		);
		$this->assertSame( 5, $selected->id );
		$this->assertNull( PurchaseContext::select_occurrence( array() ) );
	}

	/** A registration owned by another transaction never supplies context. */
	public function test_registrations_of_other_transactions_are_ignored() {
		$context = $this->resolver(
			array( 1, 2 ),
			array(
				1 => array( 99, 30 ),
				2 => array( 42, 31 ),
			),
			array(
				30 => $this->occurrence( 30, '2026-11-05 19:30:00', 50, 'Other' ),
				31 => $this->occurrence( 31, '2026-11-12 19:30:00', 12, 'Mix' ),
			)
		)->for_transaction( $this->transaction() );
		$this->assertSame( 31, $context['event_date_id'] );
		$this->assertSame( array( '12' ), $context['content_ids'] );
	}

	/** Missing registrations, occurrences or models yield no context. */
	public function test_missing_registrations_yield_no_context() {
		$this->assertSame( array(), $this->resolver( array(), array(), array() )->for_transaction( $this->transaction() ) );
		$this->assertSame( array(), $this->resolver( array( 7 ), array(), array() )->for_transaction( $this->transaction() ) );
		$this->assertSame( array(), $this->resolver( array( 7 ), array( 7 => array( 42, 30 ) ), array() )->for_transaction( $this->transaction() ) );
		$this->assertSame( array(), ( new PurchaseContext() )->for_transaction( $this->transaction() ) );
	}

	/** A failing lookup never escapes into payment completion. */
	public function test_lookup_errors_yield_no_context() {
		$context = $this->resolver( new \RuntimeException( 'db gone' ), array(), array() )->for_transaction( $this->transaction() );
		$this->assertSame( array(), $context );
	}

	/** A missing title or date is omitted on its own; the rest is still sent. */
	public function test_missing_fields_are_omitted_individually() {
		$context = $this->resolver(
			array( 7 ),
			array( 7 => array( 42, 30 ) ),
			array( 30 => $this->occurrence( 30, null, 12, null ) )
		)->for_transaction( $this->transaction() );
		$this->assertSame(
			array(
				'content_ids'   => array( '12' ),
				'event_date_id' => 30,
			),
			$context
		);
	}

	/** Normalization drops malformed fields instead of repairing them. */
	public function test_normalize_drops_malformed_fields() {
		$this->assertSame( array(), PurchaseContext::normalize( 'nope' ) );
		$this->assertSame( array(), PurchaseContext::normalize( null ) );
		$this->assertSame(
			array( 'content_ids' => array( '12', 'event-date:3' ) ),
			PurchaseContext::normalize(
				array(
					'content_name'     => '<b></b>',
					'content_ids'      => array( '12', 12, 'event-date:3', 'event-date:0', 'x' ),
					'event_date_id'    => '30',
					'event_start_date' => '2026-02-30',
				)
			)
		);
	}
}
