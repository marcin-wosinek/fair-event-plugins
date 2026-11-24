<?php
/**
 * Telegram ticket sale alert text.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEventsShared\Helpers\DisplayText;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * Builds the Telegram HTML message of one ticket sale (#2448): the event,
 * its dates, each ticket type with its quantity and the charged total.
 *
 * Every value is decoded once ({@see DisplayText}) and then escaped for
 * Telegram HTML, translated text included, so a title such as
 * `La&nbsp;Mutable` reads "La Mutable" and tag-like text stays text. The
 * buyer is never named.
 */
class SaleAlertFormatter {
	/**
	 * Most dates and ticket types listed before the rest are counted.
	 */
	public const MAX_LINES = 10;

	/**
	 * Most dates and ticket types listed per event in a digest.
	 */
	public const DIGEST_EVENT_LINES = 5;

	/**
	 * Longest digest, in characters, kept under Telegram's 4096 limit
	 * with room for the closing line.
	 */
	public const DIGEST_MAX_LENGTH = 3800;

	/**
	 * The message.
	 *
	 * @param array $sale `{ title, dates: string[], tickets: { name, quantity }[], amount, currency }`.
	 * @return string Telegram HTML.
	 */
	public static function html( array $sale ) {
		$title = DisplayText::event_title( (string) ( $sale['title'] ?? '' ), __( '(untitled event)', 'fair-events' ) );

		$lines   = array();
		$lines[] = '<b>' . self::text( __( 'New ticket sale', 'fair-events' ) ) . '</b>';
		$lines[] = '<b>' . DisplayText::html( $title ) . '</b>';
		foreach ( self::capped( (array) ( $sale['dates'] ?? array() ) ) as $date ) {
			$lines[] = self::text( $date );
		}
		$lines[] = '';

		$tickets = array();
		foreach ( (array) ( $sale['tickets'] ?? array() ) as $ticket ) {
			$name      = DisplayText::decode( (string) ( $ticket['name'] ?? '' ) );
			$tickets[] = sprintf(
				/* translators: 1: number of tickets, 2: ticket type name */
				__( '%1$d × %2$s', 'fair-events' ),
				(int) ( $ticket['quantity'] ?? 0 ),
				'' !== trim( $name ) ? $name : __( 'Ticket', 'fair-events' )
			);
		}
		foreach ( self::capped( $tickets ) as $ticket ) {
			$lines[] = DisplayText::html( $ticket );
		}
		$lines[] = '';

		$lines[] = self::text(
			sprintf(
				/* translators: %s: amount charged with its currency, for example 24.00 EUR */
				__( 'Total: %s', 'fair-events' ),
				Money::format_display( (float) ( $sale['amount'] ?? 0 ), (string) ( $sale['currency'] ?? '' ) )
			)
		);

		return implode( "\n", $lines );
	}

	/**
	 * The digest of several sales (#2449): every event with its dates, the
	 * tickets sold per type, its number of sales and their total, then the
	 * overall total. Events are listed in the order of their first sale;
	 * those that don't fit are counted in a closing line.
	 *
	 * @param array[] $sales Each `{ event_id, title, dates: string[], tickets: { ticket_type_id, name, quantity }[], amount, currency }`.
	 * @return string Telegram HTML.
	 */
	public static function digest_html( array $sales ) {
		$events = array();
		$totals = array();
		foreach ( $sales as $sale ) {
			$id = (int) ( $sale['event_id'] ?? 0 );
			if ( ! isset( $events[ $id ] ) ) {
				$events[ $id ] = array(
					'title'   => DisplayText::event_title( (string) ( $sale['title'] ?? '' ), __( '(untitled event)', 'fair-events' ) ),
					'dates'   => array(),
					'tickets' => array(),
					'sales'   => 0,
					'totals'  => array(),
				);
			}
			$event = &$events[ $id ];
			foreach ( (array) ( $sale['dates'] ?? array() ) as $date ) {
				$event['dates'][ (string) $date ] = true;
			}
			foreach ( (array) ( $sale['tickets'] ?? array() ) as $ticket ) {
				$name = DisplayText::decode( (string) ( $ticket['name'] ?? '' ) );
				$name = '' !== trim( $name ) ? $name : __( 'Ticket', 'fair-events' );
				$type = (int) ( $ticket['ticket_type_id'] ?? 0 ) . '|' . $name;
				if ( ! isset( $event['tickets'][ $type ] ) ) {
					$event['tickets'][ $type ] = array(
						'name'     => $name,
						'quantity' => 0,
					);
				}
				$event['tickets'][ $type ]['quantity'] += (int) ( $ticket['quantity'] ?? 0 );
			}
			$currency                     = (string) ( $sale['currency'] ?? '' );
			$event['totals'][ $currency ] = ( $event['totals'][ $currency ] ?? 0 ) + (float) ( $sale['amount'] ?? 0 );
			$totals[ $currency ]          = ( $totals[ $currency ] ?? 0 ) + (float) ( $sale['amount'] ?? 0 );
			++$event['sales'];
			unset( $event );
		}

		$count  = count( $sales );
		$header = array(
			'<b>' . self::text( __( 'Ticket sales digest', 'fair-events' ) ) . '</b>',
			self::text(
				sprintf(
					/* translators: 1: number of ticket sales, 2: amounts charged with their currencies, for example 72.00 EUR */
					_n( '%1$d sale, total: %2$s', '%1$d sales, total: %2$s', $count, 'fair-events' ),
					$count,
					self::amounts( $totals )
				)
			),
		);

		$blocks = array();
		foreach ( $events as $event ) {
			$lines   = array( '<b>' . DisplayText::html( $event['title'] ) . '</b>' );
			$capped  = self::capped( array_keys( $event['dates'] ), self::DIGEST_EVENT_LINES );
			$tickets = array();
			foreach ( $event['tickets'] as $ticket ) {
				$tickets[] = sprintf(
					/* translators: 1: number of tickets, 2: ticket type name */
					__( '%1$d × %2$s', 'fair-events' ),
					$ticket['quantity'],
					$ticket['name']
				);
			}
			foreach ( $capped as $date ) {
				$lines[] = self::text( $date );
			}
			foreach ( self::capped( $tickets, self::DIGEST_EVENT_LINES ) as $ticket ) {
				$lines[] = DisplayText::html( $ticket );
			}
			$lines[] = self::text(
				sprintf(
					/* translators: 1: number of ticket sales for the event, 2: amounts charged with their currencies */
					_n( '%1$d sale: %2$s', '%1$d sales: %2$s', $event['sales'], 'fair-events' ),
					$event['sales'],
					self::amounts( $event['totals'] )
				)
			);
			$blocks[] = implode( "\n", $lines );
		}

		$message = implode( "\n", $header );
		foreach ( $blocks as $index => $block ) {
			$candidate = $message . "\n\n" . $block;
			if ( mb_strlen( $candidate ) > self::DIGEST_MAX_LENGTH ) {
				$more = count( $blocks ) - $index;
				return $message . "\n\n" . self::text(
					sprintf(
						/* translators: %d: number of further events whose sales are not listed */
						_n( 'and %d more event', 'and %d more events', $more, 'fair-events' ),
						$more
					)
				);
			}
			$message = $candidate;
		}
		return $message;
	}

	/**
	 * Amounts by currency, for example "72.00 EUR, 10.00 USD".
	 *
	 * @param array<string, float> $totals Amount by currency.
	 * @return string
	 */
	private static function amounts( array $totals ) {
		$parts = array();
		foreach ( $totals as $currency => $amount ) {
			$parts[] = Money::format_display( (float) $amount, (string) $currency );
		}
		return implode( ', ', $parts );
	}

	/**
	 * Decode stored or translated text once and escape it for Telegram HTML.
	 *
	 * @param string $value Text.
	 * @return string
	 */
	private static function text( $value ) {
		return DisplayText::html( DisplayText::decode( (string) $value ) );
	}

	/**
	 * At most a number of lines ({@see self::MAX_LINES} by default), the
	 * rest counted in one more.
	 *
	 * @param string[] $lines Plain text lines.
	 * @param int      $max   Most lines.
	 * @return string[]
	 */
	private static function capped( array $lines, $max = self::MAX_LINES ) {
		$lines = array_values( $lines );
		if ( count( $lines ) <= $max ) {
			return $lines;
		}
		$more    = count( $lines ) - $max + 1;
		$lines   = array_slice( $lines, 0, $max - 1 );
		$lines[] = sprintf(
			/* translators: %d: number of further lines not shown */
			_n( 'and %d more', 'and %d more', $more, 'fair-events' ),
			$more
		);
		return $lines;
	}
}
