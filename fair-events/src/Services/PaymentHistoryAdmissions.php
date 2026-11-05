<?php
/**
 * Which historical relationships become purchases
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Helpers\EventTiming;
use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Applies the admission rule of PAYMENT_HISTORY_MIGRATION.md §4.1 and §4.3
 * to Fair Audience relationships up to the backfill's cutoff:
 *
 * - a relationship a purchase already names as its provenance is done;
 * - `pending_payment` is left for a later pass, once the live writers
 *   resolved its hold;
 * - `interested` and `collaborator` never become purchases;
 * - a generated occurrence's relationship duplicating a whole-series pass
 *   on its master is `duplicate_series_relationship`;
 * - a `signed_up` relationship becomes a purchase when its participant has
 *   no active purchase on the date (or of its ticket type) and holds no
 *   active ticket there (ShadowPurchases::qualifies(), the rule the live
 *   shadow writers use).
 *
 * The dry run asks the same questions through PaymentHistoryPurchasePlanner,
 * so its planned purchases are exactly the ones the backfill creates.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PaymentHistoryAdmissions implements PaymentHistoryPurchasePlanner {

	const EXISTING_PURCHASE = 'existing_purchase';
	const PENDING           = 'pending';
	const NOT_ADMISSION     = 'not_admission';
	const DUPLICATE_SERIES  = 'duplicate_series_relationship';
	const ADMISSION         = 'admission';

	/**
	 * Highest relationship ID the backfill covers.
	 *
	 * @var int
	 */
	private $cutoff;

	/**
	 * Planned relationships, cached per instance.
	 *
	 * @var array<int, array|null>
	 */
	private $planned = array();

	/**
	 * Constructor.
	 *
	 * @param int $cutoff Highest relationship ID the backfill covers.
	 */
	public function __construct( $cutoff ) {
		$this->cutoff = (int) $cutoff;
	}

	/**
	 * What the backfill does with a relationship.
	 *
	 * @param object $relationship Relationship row (ShadowPurchases::relationship()).
	 * @return string One of the class constants.
	 */
	public static function classify( $relationship ) {
		if ( ShadowPurchases::purchase_for( (int) $relationship->id ) ) {
			return self::EXISTING_PURCHASE;
		}
		if ( 'pending_payment' === $relationship->label ) {
			return self::PENDING;
		}
		if ( 'signed_up' !== $relationship->label ) {
			return self::NOT_ADMISSION;
		}
		if ( self::duplicates_series_pass( $relationship ) ) {
			return self::DUPLICATE_SERIES;
		}
		return ShadowPurchases::qualifies( $relationship ) ? self::ADMISSION : self::NOT_ADMISSION;
	}

	/**
	 * Whether a generated occurrence's relationship is covered by the same
	 * participant's whole-series pass on the series master: a signed-up
	 * master relationship, or a confirmed purchase there, of a whole-series
	 * ticket type, bought before the occurrence's pass cutoff (§4.3, §4.5).
	 *
	 * @param object $relationship Relationship row.
	 * @return bool
	 */
	public static function duplicates_series_pass( $relationship ) {
		global $wpdb;

		$date = $wpdb->get_row(
			$wpdb->prepare( 'SELECT occurrence_type, master_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_event_dates', (int) $relationship->event_date_id )
		);
		if ( ! $date || 'generated' !== $date->occurrence_type || empty( $date->master_id ) ) {
			return false;
		}

		$occurrence = EventDates::get_by_id( (int) $relationship->event_date_id );
		$cutoff     = $occurrence ? EventTiming::series_pass_cutoff( $occurrence->get_timing() ) : null;
		// Relationship times are UTC; purchase times are site time.
		$cutoff_gmt  = $cutoff ? get_gmt_from_date( $cutoff ) : '9999-12-31 23:59:59';
		$cutoff_site = $cutoff ? $cutoff : '9999-12-31 23:59:59';

		$types = $wpdb->prefix . 'fair_events_ticket_types';
		$pass  = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT 1 FROM %i AS ep INNER JOIN %i AS tt ON tt.id = ep.ticket_type_id
				WHERE ep.participant_id = %d AND ep.event_date_id = %d AND ep.label = 'signed_up'
				AND tt.recurrence_scope = 'whole_series' AND ep.created_at <= %s LIMIT 1",
				$wpdb->prefix . 'fair_audience_event_participants',
				$types,
				(int) $relationship->participant_id,
				(int) $date->master_id,
				$cutoff_gmt
			)
		);
		if ( $pass ) {
			return true;
		}

		return (bool) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT 1 FROM %i AS s INNER JOIN %i AS tt ON tt.id = s.ticket_type_id
				WHERE s.participant_id = %d AND s.event_date_id = %d AND s.status = 'confirmed'
				AND tt.recurrence_scope = 'whole_series' AND s.created_at <= %s LIMIT 1",
				$wpdb->prefix . 'fair_events_signups',
				$types,
				(int) $relationship->participant_id,
				(int) $date->master_id,
				$cutoff_site
			)
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return array|null
	 */
	public function planned_relationship( $relationship_id ) {
		$relationship_id = (int) $relationship_id;
		if ( $relationship_id <= 0 || $relationship_id > $this->cutoff ) {
			return null;
		}

		if ( ! array_key_exists( $relationship_id, $this->planned ) ) {
			$relationship                      = ShadowPurchases::audience_tables_exist() ? ShadowPurchases::relationship( $relationship_id ) : null;
			$this->planned[ $relationship_id ] = ( $relationship && self::ADMISSION === self::classify( $relationship ) )
				? array(
					'id'             => $relationship_id,
					'event_date_id'  => (int) $relationship->event_date_id,
					'participant_id' => (int) $relationship->participant_id,
				)
				: null;
		}
		return $this->planned[ $relationship_id ];
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $event_date_id  Event date ID.
	 * @param int $participant_id Participant ID.
	 * @return int[]
	 */
	public function planned_relationships_of( $event_date_id, $participant_id ) {
		global $wpdb;

		if ( (int) $participant_id <= 0 || ! ShadowPurchases::audience_tables_exist() ) {
			return array();
		}

		$ids = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE event_date_id = %d AND participant_id = %d AND id <= %d',
					$wpdb->prefix . 'fair_audience_event_participants',
					(int) $event_date_id,
					(int) $participant_id,
					$this->cutoff
				)
			)
		);

		return array_values(
			array_filter(
				$ids,
				function ( $relationship_id ) {
					return null !== $this->planned_relationship( $relationship_id );
				}
			)
		);
	}
}
