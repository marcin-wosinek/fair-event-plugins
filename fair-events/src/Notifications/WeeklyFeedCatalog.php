<?php
/**
 * Event feeds subscribers can choose for the weekly email.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Database\EventSourceRepository;

defined( 'WPINC' ) || die;

/**
 * Lists the event feeds Fair Audience offers as weekly email subscriptions.
 *
 * A feed is identified by its event source's numeric ID, which stays the same
 * when the feed is renamed and is never reused when a feed is deleted and a
 * new one takes its slug. Only IDs and names leave this class: the external
 * sources a feed is built from stay private.
 *
 * Fair Audience checks for these methods before calling them. Never change
 * their signatures; add new methods instead.
 */
class WeeklyFeedCatalog {

	/**
	 * Event source repository.
	 *
	 * @var EventSourceRepository
	 */
	private $sources;

	/**
	 * Bulk email configurations' settings, or null to read the stored ones.
	 *
	 * @var array[]|null
	 */
	private $configurations;

	/**
	 * Constructor.
	 *
	 * @param EventSourceRepository|null $sources        Event source repository.
	 * @param array[]|null               $configurations Bulk email settings, for tests.
	 */
	public function __construct( $sources = null, $configurations = null ) {
		$this->sources        = $sources ? $sources : new EventSourceRepository();
		$this->configurations = $configurations;
	}

	/**
	 * Feeds a subscriber can choose: enabled feeds that at least one enabled
	 * weekly email configuration sends.
	 *
	 * @return array[] Feeds in name order, each with `id` and `name`.
	 */
	public function subscribable() {
		$slugs = array();
		foreach ( $this->bulk_email_settings() as $settings ) {
			if ( $settings['enabled'] && '' !== $settings['source_slug'] ) {
				$slugs[ $settings['source_slug'] ] = true;
			}
		}

		$feeds = array();
		foreach ( $this->sources->get_all( true ) as $source ) {
			if ( ! empty( $source['enabled'] ) && isset( $slugs[ $source['slug'] ] ) ) {
				$feeds[] = self::feed( $source );
			}
		}

		usort(
			$feeds,
			static function ( $a, $b ) {
				return strcasecmp( $a['name'], $b['name'] );
			}
		);

		return $feeds;
	}

	/**
	 * Names of feeds that still exist, whether or not they can be chosen now.
	 *
	 * @param int[] $ids Feed IDs.
	 * @return array[] Existing feeds, each with `id` and `name`; deleted ones are left out.
	 */
	public function describe( array $ids ) {
		$feeds = array();
		foreach ( array_unique( array_map( 'intval', $ids ) ) as $id ) {
			$source = $id > 0 ? $this->sources->get_by_id( $id ) : null;
			if ( $source ) {
				$feeds[] = self::feed( $source );
			}
		}

		return $feeds;
	}

	/**
	 * The public part of an event source.
	 *
	 * @param array $source Event source row.
	 * @return array{id: int, name: string}
	 */
	private static function feed( array $source ) {
		return array(
			'id'   => (int) $source['id'],
			'name' => (string) $source['name'],
		);
	}

	/**
	 * Every bulk email configuration's settings.
	 *
	 * @return array[]
	 */
	private function bulk_email_settings() {
		if ( null !== $this->configurations ) {
			return array_map( array( BulkEmailSettings::class, 'sanitize' ), $this->configurations );
		}

		$settings = array();
		foreach ( Configurations::all( Configurations::BULK_EMAIL ) as $configuration ) {
			$settings[] = BulkEmailSettings::sanitize( $configuration['settings'] );
		}

		return $settings;
	}
}
