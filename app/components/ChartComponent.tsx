'use client';

import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

interface ChartComponentProps {
  ppgData: number[];
  valleys: { index: number; value: number }[];
}

export default function ChartComponent({
  ppgData,
  valleys,
}: ChartComponentProps) {
  const hasData = ppgData.length >= 2;

  const chartData = {
    labels: Array.from({ length: ppgData.length }, (_, i) => i.toString()),
    datasets: [
      {
        label: 'PPG Signal',
        data: ppgData,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.4,
        fill: true,
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        pointRadius: 0,
      },
      {
        label: 'Valleys',
        data: ppgData.map(
          (_, i) => valleys.find((v) => v.index === i)?.value ?? null,
        ),
        pointBackgroundColor: 'red',
        pointRadius: 3,
        showLine: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    scales: {
      y: {
        beginAtZero: false,
      },
    },
    animation: {
      duration: 0,
    },
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md">
      <h2 className="text-lg font-semibold mb-2">PPG Signal</h2>
      <div className="h-75 min-h-[200px]">
        {hasData ? (
          <Line data={chartData} options={chartOptions} />
        ) : (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded bg-gray-100 text-gray-500">
            Start recording to see the signal
          </div>
        )}
      </div>
    </div>
  );
}
