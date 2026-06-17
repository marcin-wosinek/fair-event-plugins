/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const siteCurrency = window.fairPaymentsConnector?.currency || 'EUR';

const formatEur = (amount) =>
	new Intl.NumberFormat('de-DE', {
		style: 'currency',
		currency: siteCurrency,
	}).format(amount ?? 0);

const ProgressBar = ({ value, max }) => {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	const color = pct >= 100 ? '#d63638' : pct >= 80 ? '#946800' : '#007017';

	return (
		<div>
			<div
				style={{
					background: '#ddd',
					borderRadius: '4px',
					overflow: 'hidden',
					height: '12px',
				}}
			>
				<div
					style={{
						width: `${pct}%`,
						background: color,
						height: '100%',
						transition: 'width 0.3s',
					}}
				/>
			</div>
			<p style={{ margin: '4px 0 0', color }}>
				{formatEur(value)} / {formatEur(max)} ({Math.round(pct)}%)
			</p>
		</div>
	);
};

const StatCard = ({ label, children }) => (
	<Card>
		<CardHeader>
			<h3 style={{ margin: 0 }}>{label}</h3>
		</CardHeader>
		<CardBody>{children}</CardBody>
	</Card>
);

const FeeDashboardApp = () => {
	const [summary, setSummary] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		apiFetch({
			path: '/fair-payments-connector/v1/dashboard/monthly-summary',
		})
			.then((data) => setSummary(data))
			.catch((err) =>
				setError(
					err.message ||
						__(
							'Failed to load dashboard data.',
							'fair-payments-connector'
						)
				)
			)
			.finally(() => setLoading(false));
	}, []);

	const monthLabel = summary?.month
		? new Date(summary.month + '-01').toLocaleString('default', {
				month: 'long',
				year: 'numeric',
		  })
		: '';

	const planEntries = summary?.plan_breakdown
		? Object.entries(summary.plan_breakdown)
		: [];
	const [basePlan, ...addOns] = planEntries;

	return (
		<div className="wrap fair-payments-connector-fee-dashboard-page">
			<VStack spacing={4}>
				<HStack justify="space-between" align="center">
					<h1 style={{ margin: 0 }}>
						{__('Fee Dashboard', 'fair-payments-connector')}
					</h1>
					{monthLabel && (
						<span style={{ color: '#666' }}>{monthLabel}</span>
					)}
				</HStack>

				{summary?.testmode && (
					<Notice status="warning" isDismissible={false}>
						{__(
							'Test mode — these figures reflect test transactions only.',
							'fair-payments-connector'
						)}
					</Notice>
				)}

				{error && (
					<Notice
						status="error"
						isDismissible
						onRemove={() => setError(null)}
					>
						{error}
					</Notice>
				)}

				{loading && (
					<div>
						<Spinner />
					</div>
				)}

				{!loading && summary && (
					<VStack spacing={4}>
						<StatCard
							label={__(
								'Total payment volume this month',
								'fair-payments-connector'
							)}
						>
							<p style={{ fontSize: '1.5em', margin: 0 }}>
								{formatEur(summary.total_volume)}
							</p>
						</StatCard>

						<StatCard
							label={__(
								'Integration fees this month',
								'fair-payments-connector'
							)}
						>
							<p style={{ fontSize: '1.5em', margin: 0 }}>
								{formatEur(summary.total_fees)}
							</p>
						</StatCard>

						<StatCard
							label={__(
								'Monthly fee cap',
								'fair-payments-connector'
							)}
						>
							<VStack spacing={2}>
								<ProgressBar
									value={summary.total_fees}
									max={summary.fee_cap}
								/>
								<p style={{ margin: 0, color: '#666' }}>
									{formatEur(summary.cap_remaining)}{' '}
									{__('remaining', 'fair-payments-connector')}
								</p>
							</VStack>
						</StatCard>

						{planEntries.length > 0 && (
							<StatCard
								label={__(
									'Active plan',
									'fair-payments-connector'
								)}
							>
								<VStack spacing={1}>
									{basePlan && (
										<p style={{ margin: 0 }}>
											<strong>{basePlan[0]}</strong> (
											{formatEur(basePlan[1])})
										</p>
									)}
									{addOns.map(([slug, price]) => (
										<p key={slug} style={{ margin: 0 }}>
											+ {slug} (+{formatEur(price)})
										</p>
									))}
								</VStack>
							</StatCard>
						)}
					</VStack>
				)}
			</VStack>
		</div>
	);
};

export default FeeDashboardApp;
