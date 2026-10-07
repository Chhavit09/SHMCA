#include <iostream>
#include <fstream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <cmath>
#include <unistd.h>

using namespace std;

// OOP Unit 2: Fundamentals of Operator Overloading

struct Vector3 {
    double x, y, z;
    Vector3() { x = 0; y = 0; z = 0; }
    Vector3(double a, double b, double c) { x = a; y = b; z = c; }
    Vector3 operator+(const Vector3 &o) const { 
        return Vector3(x + o.x, y + o.y, z + o.z); 
    } Vector3 operator-(const Vector3 &o) const { 
        return Vector3(x - o.x, y - o.y, z - o.z); 
    } Vector3 operator*(double s) const { 
        return Vector3(x * s, y * s, z * s); 
    }
};

inline double dist3D(Vector3 a, Vector3 b) {
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    double dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

#include "Queues_DSA.h"
#include "AVL_Tree.h"
#include "Satellites_OOP.h"
#include "FlightComputer.h"
#include "Chaos_Engine.h"

int REPAIR_DURATION_TICKS = 20;

Satellite* createSatelliteAroundEarth(int id, string name, int typeChoice) {
    double orbitRadius = 4200 + 600 + rand() % 400; 
    double angle = (rand() % 360) * 3.14159265 / 180.0;
    double speed = 6.5 + (rand() % 20) / 10.0;
    
    Vector3 pos(orbitRadius * cos(angle), orbitRadius * sin(angle), (rand() % 200 - 100) / 10.0);
    Vector3 vel(-sin(angle) * speed, cos(angle) * speed, 0);

    if (typeChoice == 1) {
        return new CommunicationSatellite(id, name, pos, vel);
    } else {
        return new ImagingSatellite(id, name, pos, vel);
    }
}

int main() {
    srand((unsigned) time(0));
    cout << "---------------------------------\n";
    cout << " ORBITAL - Earth Orbit Edition\n";
    cout << "---------------------------------\n\n";

    int numSats;
    cout << "How many satellites in Earth orbit? (1-6): ";
    cin >> numSats;
    if (numSats < 1) numSats = 1;
    if (numSats > 6) numSats = 6;

    vector<Satellite*> satellites;
    for (int i = 0; i < numSats; i++) {
        string name;
        int typeChoice;
        cout << "\nSatellite #" << (i + 1) << " Name (no spaces): ";
        cin >> name;
        cout << "Type (1: Communication, 2: Imaging): ";
        cin >> typeChoice;
        satellites.push_back(createSatelliteAroundEarth(i + 1, name, typeChoice));
    }
