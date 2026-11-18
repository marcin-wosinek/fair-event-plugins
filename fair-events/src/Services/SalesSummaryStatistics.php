<?php
/**
 * Sales summary figures.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventDates;
use FairEventsShared\Helpers\DisplayText;

defined( 'WPINC' ) || die;

/**
 * Ticket sales and paid revenue per event for a reporting period (#2306).
 *
 * An event is what owns an organizer assignment: a single event, or a
 * series master standing for every generated occurrence of the series. Each
 * stored ticket and paid allocation therefore counts once, on its own
 * event, and a whole-series pass appears once under its series.
 *
 * Tickets follow {@see EventTicketStatistics}: confirmed ticket units count
 * one each, and a confirmed purchase not yet backfilled to units counts by
 * its quantity. A ticket belongs to the period its purchase was made in, by
 * the purchase's site-local `created_at`; cancelling or refunding a ticket
 * removes it. Revenue follows {@see PurchasePaymentHistory::event_dates_revenue()}.
 * Totals are counted when the summary is generated, whenever the tickets
 * were sold.
 *
 * Only Fair Events purchases are read — no Fair Audience relationship and no
 * participant or payment detail leaves this class.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- generated %d lists.
 */
class SalesSummaryStatistics {

	/**
	 * Events with ticket sales or paid revenue in a period.
	 *
	 * @param string $from Site-local 'Y-m-d H:i:s' period start, included.
	 * @param string $to   Site-local 'Y-m-d H:i:s' period end, excluded.
	 * @return array[] Per event, in title order: event_id (the owning event
	 *     date), title (decoded text), is_series, period_tickets,
	 *     total_tickets, period_revenue and total_revenue (summaries).
	 */
	public function for_period( $from, $to ) {
		$period_tickets = self::ticket_counts( $from, $to, array() );
		$active_dates   = array_merge( array_keys( $period_tickets ), PurchasePaymentHistory::event_dates_with_revenue_between( $from, $to ) );
		if ( ! $active_dates ) {
			return array();
		}

		$owners = self::owners( $active_dates );
		$series = self::series_dates( array_values( array_unique( $owners ) ) );

		$total_tickets = self::ticket_counts( null, null, array_merge( ...array_values( $series ) ) );
		$masters       = EventDates::get_by_ids( array_keys( $series ) );

		$events = array();
		foreach ( $series as $owner_id => $date_ids ) {
			$period_count = 0;
			$total_count  = 0;
			foreach ( $date_ids as $date_id ) {
				$period_count += $period_tickets[ $date_id ] ?? 0;
				$total_count  += $total_tickets[ $date_id ] ?? 0;
			}

			$revenue = PurchasePaymentHistory::event_dates_revenue( $date_ids, $from, $to );
			if ( 0 === $period_count && ! self::has_amount( $revenue['period'] ) ) {
				// Only a cancelled or refunded sale touched it.
				continue;
			}

			$master   = $masters[ $owner_id ] ?? null;
			$events[] = array(
				'event_id'       => (int) $owner_id,
				'title'          => DisplayText::event_title( $master ? (string) $master->get_display_title() : '', __( '(untitled event)', 'fair-events' ) ),
				'is_series'      => $master && 'master' === $master->occurrence_type,
				'period_tickets' => $period_count,
				'total_tickets'  => $total_count,
				'period_revenue' => $revenue['period'],
				'total_revenue'  => $revenue['total'],
			);
		}

		usort(
			$events,
			static fn( $a, $b ) => array( $a['title'], $a['event_id'] ) <=> array( $b['title'], $b['event_id'] )
		);
		return $events;
	}

	/**
	 * Whether a revenue summary has paid money in it.
	 *
	 * @param array $revenue Revenue summary.
	 * @return bool
	 */
	private static function has_amount( array $revenue ) {
		return null !== $revenue['total'] && ( $revenue['total'] > 0 || $revenue['excluded_currencies'] );
	}

	/**
	 * The owning event of each stored date: a generated occurrence's series
	 * master, otherwise the date itself.
	 *
	 * @param int[] $date_ids Stored event date IDs.
	 * @return array<int, int> Owner ID by date ID.
	 */
	private static function owners( array $date_ids ) {
		global $wpdb;

		$date_ids = self::ids( $date_ids );
		$owners   = array();
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, master_id, occurrence_type FROM %i WHERE id IN ( ' . implode( ', ', array_fill( 0, count( $date_ids ), '%d' ) ) . ' )',
				array_merge( array( $wpdb->prefix . 'fair_event_dates' ), $date_ids )
			),
			ARRAY_A
		) as $row ) {
			$owners[ (int) $row['id'] ] = 'generated' === $row['occurrence_type'] && (int) $row['master_id'] ? (int) $row['master_id'] : (int) $row['id'];
		}
		return $owners;
	}

	/**
	 * Every stored date of each event: the event itself and, for a series,
	 * its generated occurrences.
	 *
	 * @param int[] $owner_ids Owning event date IDs.
	 * @return array<int, int[]> Date IDs by owner ID.
	 */
	private static function series_dates( array $owner_ids ) {
		global $wpdb;

		$owner_ids = self::ids( $owner_ids );
		$series    = array();
		foreach ( $owner_ids as $owner_id ) {
			$series[ $owner_id ] = array( $owner_id );
		}
		if ( ! $owner_ids ) {
			return $series;
		}

		$list = implode( ', ', array_fill( 0, count( $owner_ids ), '%d' ) );
		foreach ( (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, master_id FROM %i WHERE occurrence_type = 'generated' AND master_id IN ( {$list} ) ORDER BY id ASC",
				array_merge( array( $wpdb->prefix . 'fair_event_dates' ), $owner_ids )
			),
			ARRAY_A
		) as $row ) {
			$series[ (int) $row['master_id'] ][] = (int) $row['id'];
		}
		return $series;
	}

	/**
	 * Confirmed tickets per stored date: units, plus confirmed purchases
	 * without units by their quantity.
	 *
	 * @param string|null $from     Site-local purchase time start, included; null for all time.
	 * @param string|null $to       Site-local purchase time end, excluded; null for all time.
	 * @param int[]       $date_ids Dates to count; empty for every date (with a period).
	 * @return array<int, int> Ticket count by stored date ID.
	 */
	private static function ticket_counts( $from, $to, array $date_ids ) {
		global $wpdb;

		$date_ids = self::ids( $date_ids );
		if ( null === $from && ! $date_ids ) {
			return array();
		}

		$counts = array();
		foreach ( array( 't.event_date_id', 's.event_date_id' ) as $index => $column ) {
			$where = array();
			$args  = array();
			if ( null !== $from ) {
				$where[] = 's.created_at >= %s AND s.created_at < %s';
				$args[]  = (string) $from;
				$args[]  = (string) $to;
			}
			if ( $date_ids ) {
				$where[] = "{$column} IN ( " . implode( ', ', array_fill( 0, count( $date_ids ), '%d' ) ) . ' )';
				$args    = array_merge( $args, $date_ids );
			}
			$condition = implode( ' AND ', $where );

			$rows = 0 === $index
				? $wpdb->get_results(
					$wpdb->prepare(
						"SELECT t.event_date_id AS date_id, COUNT(*) AS tickets
						FROM %i AS t INNER JOIN %i AS s ON s.id = t.signup_id
						WHERE t.status = 'confirmed' AND {$condition}
						GROUP BY t.event_date_id",
						array_merge( array( $wpdb->prefix . 'fair_events_tickets', $wpdb->prefix . 'fair_events_signups' ), $args )
					),
					ARRAY_A
				)
				: $wpdb->get_results(
					$wpdb->prepare(
						"SELECT s.event_date_id AS date_id, SUM( GREATEST( s.quantity, 1 ) ) AS tickets
						FROM %i AS s
						WHERE s.status = 'confirmed' AND NOT EXISTS ( SELECT 1 FROM %i AS t WHERE t.signup_id = s.id ) AND {$condition}
						GROUP BY s.event_date_id",
						array_merge( array( $wpdb->prefix . 'fair_events_signups', $wpdb->prefix . 'fair_events_tickets' ), $args )
					),
					ARRAY_A
				);

			foreach ( (array) $rows as $row ) {
				$counts[ (int) $row['date_id'] ] = ( $counts[ (int) $row['date_id'] ] ?? 0 ) + (int) $row['tickets'];
			}
		}
		return $counts;
	}

	/**
	 * Positive, distinct integer IDs.
	 *
	 * @param array $ids IDs.
	 * @return int[]
	 */
	private static function ids( array $ids ) {
		return array_values( array_unique( array_filter( array_map( 'intval', $ids ), static fn( $id ) => $id > 0 ) ) );
	}
}
