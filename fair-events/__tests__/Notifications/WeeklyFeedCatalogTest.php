<?php
/**
 * WeeklyFeedCatalog tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\WeeklyFeedCatalog;
use PHPUnit\Framework\TestCase;

/**
 * Subscribers can choose only feeds a weekly email is sent for, and only see
 * their IDs and names.
 */
class WeeklyFeedCatalogTest extends TestCase {

	/**
	 * A source repository holding the given sources.
	 *
	 * @param array[] $sources Sources by ID.
	 * @return object
	 */
	private static function sources( array $sources ) {
		return new class( $sources ) {
			/**
			 * Sources by ID.
			 *
			 * @var array[]
			 */
			private $sources;

			/**
			 * Constructor.
			 *
			 * @param array[] $sources Sources by ID.
			 */
			public function __construct( array $sources ) {
				$this->sources = $sources;
			}

			/**
			 * Sources, optionally only enabled ones.
			 *
			 * @param bool $enabled_only Whether to leave out disabled sources.
			 * @return array[]
			 */
			public function get_all( $enabled_only = false ) {
				return array_values(
					array_filter(
						$this->sources,
						static function ( $source ) use ( $enabled_only ) {
							return ! $enabled_only || $source['enabled'];
						}
					)
				);
			}

			/**
			 * One source.
			 *
			 * @param int $id Source ID.
			 * @return array|null
			 */
			public function get_by_id( $id ) {
				return $this->sources[ $id ] ?? null;
			}
		};
	}

	/**
	 * A source row.
	 *
	 * @param int    $id      ID.
	 * @param string $name    Name.
	 * @param string $slug    Slug.
	 * @param bool   $enabled Whether it is enabled.
	 * @return array
	 */
	private static function source( $id, $name, $slug, $enabled = true ) {
		return array(
			'id'           => (string) $id,
			'name'         => $name,
			'slug'         => $slug,
			'enabled'      => $enabled,
			'data_sources' => array(
				array(
					'type' => 'ical',
					'url'  => 'https://private.example.test/feed.ics',
				),
			),
			'page_id'      => null,
		);
	}

	/**
	 * Catalog over three sources.
	 *
	 * @param array[] $configurations Bulk email settings.
	 * @return WeeklyFeedCatalog
	 */
	private static function catalog( array $configurations ) {
		return new WeeklyFeedCatalog(
			self::sources(
				array(
					1 => self::source( 1, 'Workshops', 'workshops' ),
					2 => self::source( 2, 'Concerts', 'concerts' ),
					3 => self::source( 3, 'Archive', 'archive', false ),
				)
			),
			$configurations
		);
	}

	/** Only enabled feeds sent by an enabled weekly email are offered, by name. */
	public function test_offers_enabled_feeds_with_an_enabled_weekly_email() {
		$feeds = self::catalog(
			array(
				array(
					'enabled'     => true,
					'source_slug' => 'workshops',
				),
				array(
					'enabled'     => true,
					'source_slug' => 'concerts',
				),
				array(
					'enabled'     => true,
					'source_slug' => 'archive',
				),
			)
		)->subscribable();

		$this->assertSame(
			array(
				array(
					'id'   => 2,
					'name' => 'Concerts',
				),
				array(
					'id'   => 1,
					'name' => 'Workshops',
				),
			),
			$feeds
		);
	}

	/** A feed whose weekly emails are all off is not offered. */
	public function test_feed_with_only_disabled_weekly_emails_is_not_offered() {
		$feeds = self::catalog(
			array(
				array(
					'enabled'     => false,
					'source_slug' => 'workshops',
				),
				array(
					'enabled'     => true,
					'source_slug' => 'concerts',
				),
			)
		)->subscribable();

		$this->assertSame( array( 2 ), array_column( $feeds, 'id' ) );
	}

	/** Existing feeds are described whatever their state; deleted ones are left out. */
	public function test_describes_existing_feeds_only() {
		$this->assertSame(
			array(
				array(
					'id'   => 3,
					'name' => 'Archive',
				),
			),
			self::catalog( array() )->describe( array( 3, 99, 0 ) )
		);
	}
}
