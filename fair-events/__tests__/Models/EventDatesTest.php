<?php
/**
 * EventDates::get_display_url() unit tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Models;

use PHPUnit\Framework\TestCase;
use FairEvents\Models\EventDates;
use ReflectionProperty;

/**
 * Tests for EventDates::get_display_url()
 */
class EventDatesTest extends TestCase {

	/**
	 * Seed EventDates::$master_cache with a master row, bypassing the DB.
	 *
	 * @param EventDates $master Master row to cache under its own id.
	 * @return void
	 */
	private function seed_master_cache( EventDates $master ) {
		$cache_property = new ReflectionProperty( EventDates::class, 'master_cache' );
		$cache_property->setValue( null, array( $master->id => $master ) );
	}

	/**
	 * Generated occurrence with event_id = NULL and link_type = 'post'
	 * resolves the link via the master's event_id (issue #1090), with
	 * `?event_date={Y-m-d}` appended since it's a generated occurrence.
	 */
	public function test_post_link_resolves_via_master_for_generated_occurrence() {
		$master            = new EventDates();
		$master->id        = 1;
		$master->event_id  = 42;
		$master->link_type = 'post';

		$this->seed_master_cache( $master );

		$occurrence                  = new EventDates();
		$occurrence->id              = 2;
		$occurrence->event_id        = null;
		$occurrence->master_id       = 1;
		$occurrence->occurrence_type = 'generated';
		$occurrence->link_type       = 'post';
		$occurrence->start_datetime  = '2026-06-29 18:30:00';

		$this->assertSame( 'https://example.com/?p=42&event_date=2026-06-29', $occurrence->get_display_url() );
	}

	/**
	 * A generated occurrence whose master has no linked post returns null.
	 */
	public function test_post_link_returns_null_when_master_has_no_event_id() {
		$master            = new EventDates();
		$master->id        = 1;
		$master->event_id  = null;
		$master->link_type = 'post';

		$this->seed_master_cache( $master );

		$occurrence                  = new EventDates();
		$occurrence->id              = 2;
		$occurrence->event_id        = null;
		$occurrence->master_id       = 1;
		$occurrence->occurrence_type = 'generated';
		$occurrence->link_type       = 'post';

		$this->assertNull( $occurrence->get_display_url() );
	}

	/**
	 * A single (non-generated) row with its own event_id ignores the master lookup.
	 */
	public function test_post_link_uses_own_event_id_when_present() {
		$occurrence                  = new EventDates();
		$occurrence->id              = 5;
		$occurrence->event_id        = 99;
		$occurrence->master_id       = null;
		$occurrence->occurrence_type = 'single';
		$occurrence->link_type       = 'post';

		$this->assertSame( 'https://example.com/?p=99', $occurrence->get_display_url() );
	}

	/**
	 * External link type is unaffected by the master-resolution fix.
	 */
	public function test_external_link_type_unchanged() {
		$external               = new EventDates();
		$external->link_type    = 'external';
		$external->external_url = 'https://example.org/event';

		$this->assertSame( 'https://example.org/event', $external->get_display_url() );
	}

	/**
	 * A single row with its own event_id doesn't get `?event_date=` appended
	 * — the plain permalink already resolves unambiguously.
	 */
	public function test_post_link_omits_occurrence_arg_for_single_row() {
		$occurrence                  = new EventDates();
		$occurrence->id              = 5;
		$occurrence->event_id        = 99;
		$occurrence->master_id       = null;
		$occurrence->occurrence_type = 'single';
		$occurrence->link_type       = 'post';

		$this->assertSame( 'https://example.com/?p=99', $occurrence->get_display_url() );
	}

	/**
	 * The master row of a series doesn't get `?event_date=` appended either.
	 */
	public function test_post_link_omits_occurrence_arg_for_master_row() {
		$master                  = new EventDates();
		$master->id              = 1;
		$master->event_id        = 42;
		$master->occurrence_type = 'master';
		$master->link_type       = 'post';

		$this->assertSame( 'https://example.com/?p=42', $master->get_display_url() );
	}

	/**
	 * Display title resolves the #1090 shape (link_type='post',
	 * event_id NULL) via the master's event_id, same as get_display_url().
	 */
	public function test_display_title_resolves_via_master_for_generated_occurrence() {
		$master            = new EventDates();
		$master->id        = 1;
		$master->event_id  = 42;
		$master->link_type = 'post';

		$this->seed_master_cache( $master );

		$occurrence                  = new EventDates();
		$occurrence->id              = 2;
		$occurrence->event_id        = null;
		$occurrence->master_id       = 1;
		$occurrence->occurrence_type = 'generated';
		$occurrence->link_type       = 'post';

		$this->assertSame( 'Post 42', $occurrence->get_display_title() );
	}

	/**
	 * Display title returns null when the master has no linked post.
	 */
	public function test_display_title_returns_null_when_master_has_no_event_id() {
		$master            = new EventDates();
		$master->id        = 1;
		$master->event_id  = null;
		$master->link_type = 'post';

		$this->seed_master_cache( $master );

		$occurrence                  = new EventDates();
		$occurrence->id              = 2;
		$occurrence->event_id        = null;
		$occurrence->master_id       = 1;
		$occurrence->occurrence_type = 'generated';
		$occurrence->link_type       = 'post';

		$this->assertNull( $occurrence->get_display_title() );
	}

	/**
	 * Display title uses the stored title for non-post link types.
	 */
	public function test_display_title_uses_stored_title_for_external() {
		$external               = new EventDates();
		$external->link_type    = 'external';
		$external->title        = 'External Meetup';
		$external->external_url = 'https://example.org/event';

		$this->assertSame( 'External Meetup', $external->get_display_title() );
	}

	/**
	 * Resolved event id returns the row's own event_id when present.
	 */
	public function test_resolved_event_id_uses_own_event_id() {
		$occurrence            = new EventDates();
		$occurrence->id        = 5;
		$occurrence->event_id  = 99;
		$occurrence->master_id = null;

		$this->assertSame( 99, $occurrence->get_resolved_event_id() );
	}

	/**
	 * Resolved event id falls back to the master's event_id for a
	 * generated occurrence with no event_id of its own.
	 */
	public function test_resolved_event_id_falls_back_to_master() {
		$master           = new EventDates();
		$master->id       = 1;
		$master->event_id = 42;

		$this->seed_master_cache( $master );

		$occurrence                  = new EventDates();
		$occurrence->id              = 2;
		$occurrence->event_id        = null;
		$occurrence->master_id       = 1;
		$occurrence->occurrence_type = 'generated';

		$this->assertSame( 42, $occurrence->get_resolved_event_id() );
	}

	/**
	 * Resolved event id returns null for a standalone row with no
	 * event_id and no master.
	 */
	public function test_resolved_event_id_returns_null_when_unlinked() {
		$occurrence                  = new EventDates();
		$occurrence->id              = 5;
		$occurrence->event_id        = null;
		$occurrence->master_id       = null;
		$occurrence->occurrence_type = 'single';

		$this->assertNull( $occurrence->get_resolved_event_id() );
	}
}
